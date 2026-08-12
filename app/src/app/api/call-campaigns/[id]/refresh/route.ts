import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"
import {
  buildScopedCampaignWhere,
  wardIdsForClient,
  type CampaignFilterCriteria,
} from "@/lib/call-campaigns/filter"

/**
 * «Актуализировать» — пересобрать список контактов кампании под текущее
 * состояние базы по сохранённым критериям отбора (filterCriteria).
 *
 *  - Новые подходящие клиенты, которых ещё нет в кампании → добавляются как
 *    pending («Не обзвонен»).
 *  - Необработанные (pending) позиции, переставшие подходить под критерии →
 *    удаляются.
 *  - Обработанные позиции (любой статус кроме pending) сохраняются ВСЕГДА, даже
 *    если клиент больше не подходит — прогресс и результаты не теряются.
 *
 * Scope-safe (ADM-04): выборка и удаление ограничены филиальным scope того, кто
 * нажал. Скоуп-админ не добавит и не удалит контакты по клиентам вне своих
 * филиалов — чужие pending-позиции в кампании владельца он просто не трогает.
 * Доступно только для активной кампании (в архиве/закрытой — 409).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const campaign = await db.callCampaign.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!campaign) return NextResponse.json({ error: "Кампания не найдена" }, { status: 404 })
  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "Актуализировать можно только активную кампанию" },
      { status: 409 },
    )
  }

  const allowedBranchIds =
    (session.user as { allowedBranchIds?: string[] | null }).allowedBranchIds ?? null
  const scope = branchScopeFromSession(allowedBranchIds)
  const fc = (campaign.filterCriteria ?? {}) as CampaignFilterCriteria

  // Множество клиентов, подходящих под критерии СЕЙЧАС (в рамках scope), вместе с
  // подопечными — чтобы развернуть новых клиентов в строки-подопечные.
  const where = buildScopedCampaignWhere(tenantId, allowedBranchIds, fc)
  const matching = await db.client.findMany({
    where,
    select: { id: true, wards: { select: { id: true, birthDate: true } } },
  })
  const matchingIds = new Set(matching.map((c) => c.id))

  const { added, removed } = await db.$transaction(
    async (tx) => {
      // Сериализуем параллельные актуализации ОДНОЙ кампании. Без этого два
      // одновременных refresh, прочитав список до вставок друг друга, создали бы
      // дубль pending-позиции на клиента (уникального индекса (campaign, client)
      // нет). Advisory-lock уровня транзакции снимается автоматически на commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`

      // Клиенты, уже присутствующие в кампании (любой scope) — дедуп добавления.
      // Читаем ВНУТРИ транзакции под локом, чтобы второй refresh увидел вставки
      // первого и не задвоил клиента.
      const existing = await tx.callCampaignItem.findMany({
        where: { campaignId: id, tenantId },
        select: { clientId: true },
      })
      const existingIds = new Set(existing.map((i) => i.clientId))
      // Добавляем только НОВЫХ клиентов и сразу разворачиваем их в строки-
      // подопечные (одна строка = один подопечный). Клиентов, уже присутствующих
      // в кампании, не пере-разбиваем — легаси-кампании (строка по клиенту)
      // остаются как есть («старое не трогаем»).
      const toAddRows = matching
        .filter((c) => !existingIds.has(c.id))
        .flatMap((c) =>
          wardIdsForClient(c.wards, fc).map((wardId) => ({
            tenantId,
            campaignId: id,
            clientId: c.id,
            wardId,
            status: "pending" as const,
          })),
        )

      // Кандидаты на удаление — только НЕобработанные (pending) позиции, чьи
      // клиенты видны в scope нажавшего и больше не подходят под критерии.
      const pendingInScope = await tx.callCampaignItem.findMany({
        where: { campaignId: id, tenantId, status: "pending", client: scopeClientByBranch(scope) },
        select: { id: true, clientId: true },
      })
      const toRemoveIds = pendingInScope
        .filter((i) => !matchingIds.has(i.clientId))
        .map((i) => i.id)

      if (toAddRows.length > 0) {
        await tx.callCampaignItem.createMany({ data: toAddRows })
      }

      // status:"pending" в условии — защита от гонки с PATCH /items: если контакт
      // успели обработать между чтением pendingInScope и удалением, он НЕ
      // удаляется (инвариант «обработанные сохраняются ВСЕГДА»). Реально удалённое
      // считаем по del.count, а не по длине списка кандидатов.
      let removedCount = 0
      if (toRemoveIds.length > 0) {
        const del = await tx.callCampaignItem.deleteMany({
          where: { id: { in: toRemoveIds }, campaignId: id, tenantId, status: "pending" },
        })
        removedCount = del.count
      }

      // Пересчитываем счётчики кампании по факту (self-healing): всего позиций и
      // сколько из них обработано (любой статус, кроме pending).
      const total = await tx.callCampaignItem.count({ where: { campaignId: id, tenantId } })
      const completed = await tx.callCampaignItem.count({
        where: { campaignId: id, tenantId, status: { not: "pending" } },
      })
      await tx.callCampaign.update({
        where: { id },
        data: { totalItems: total, completedItems: completed },
      })

      return { added: toAddRows.length, removed: removedCount }
    },
    // Запас по времени: лок ждёт завершения параллельного refresh, а createMany
    // на большой выборке может быть небыстрым — дефолтных 5 c может не хватить.
    { timeout: 20000 },
  )

  return NextResponse.json({ added, removed })
}
