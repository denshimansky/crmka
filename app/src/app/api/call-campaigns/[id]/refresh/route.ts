import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"
import {
  applicationStageForWardScope,
  buildScopedCampaignWhere,
  wardIdsForClient,
  type CampaignFilterCriteria,
} from "@/lib/call-campaigns/filter"
import { loadNoAnswerDesiredRows } from "@/lib/call-campaigns/no-answer-source"

/**
 * «Актуализировать» — пересобрать список контактов кампании под текущее
 * состояние базы по сохранённым критериям отбора (filterCriteria).
 *
 *  - Новые подходящие клиенты, которых ещё нет в кампании → добавляются как
 *    pending («Не обзвонен»).
 *  - Существующие клиенты пере-разворачиваются на их ТЕКУЩИХ подопечных: детям,
 *    появившимся после создания кампании, заводятся строки (снимок «оживает»).
 *  - Необработанные (pending) позиции, переставшие подходить → удаляются: клиент
 *    выпал из критериев ЛИБО подопечный строки больше не актуален (ребёнок удалён,
 *    либо плейсхолдер ward=null заменяется строками появившихся детей).
 *  - Обработанные позиции (любой статус кроме pending) сохраняются ВСЕГДА, даже
 *    если клиент больше не подходит — прогресс и результаты не теряются.
 *  - «Обзвон по не ответившим» (mode="no_answer") — только ДОБАВЛЯЕТ: refresh не
 *    удаляет никого, даже если контакту с тех пор дозвонились в исходном обзвоне.
 *    Он остаётся в кампании со статусом, который поставит оператор.
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

  const isNoAnswer = fc.mode === "no_answer"

  // Множество клиентов, подходящих под критерии СЕЙЧАС (в рамках scope), вместе с
  // подопечными — чтобы развернуть новых клиентов в строки-подопечные. Для
  // этапа-заявки подтягиваем заявочных подопечных (сужение, как при создании).
  // Режим «Обзвон по не ответившим» источник берёт не из базы, а из no_answer-
  // позиций других кампаний — его грузим ВНУТРИ транзакции под локом (ниже).
  const stage = isNoAnswer ? null : applicationStageForWardScope(fc)
  const matching = isNoAnswer
    ? []
    : await db.client.findMany({
        where: buildScopedCampaignWhere(tenantId, allowedBranchIds, fc),
        select: {
          id: true,
          wards: { select: { id: true, birthDate: true } },
          ...(stage
            ? {
                applications: {
                  where: { status: "active", deletedAt: null, stage: stage as never },
                  select: { wardId: true },
                },
              }
            : {}),
        },
      })

  const { added, removed } = await db.$transaction(
    async (tx) => {
      // Сериализуем параллельные актуализации ОДНОЙ кампании. Без этого два
      // одновременных refresh, прочитав список до вставок друг друга, создали бы
      // дубль pending-позиции на клиента (уникального индекса (campaign, client)
      // нет). Advisory-lock уровня транзакции снимается автоматически на commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`

      // Все текущие позиции кампании (любой scope) — читаем ВНУТРИ транзакции под
      // локом, чтобы параллельный refresh увидел вставки и не задвоил. wardId нужен,
      // чтобы синхронизировать ПОДОПЕЧНЫХ существующих клиентов (не только добавлять
      // новых клиентов): у клиента, созданного бездетным или пополнившего состав
      // после создания кампании, новые дети раньше не попадали в обзвон.
      const existing = await tx.callCampaignItem.findMany({
        where: { campaignId: id, tenantId },
        select: { id: true, clientId: true, wardId: true, status: true },
      })
      // clientId → набор уже присутствующих wardId (включая null-плейсхолдер).
      const existingWardsByClient = new Map<string, Set<string | null>>()
      for (const it of existing) {
        let s = existingWardsByClient.get(it.clientId)
        if (!s) { s = new Set(); existingWardsByClient.set(it.clientId, s) }
        s.add(it.wardId)
      }

      // Клиенты с ОБРАБОТАННОЙ легаси-строкой (wardId=null, статус ≠ pending): их
      // «контакт по клиенту» уже завершён в эпоху обзвона по клиенту (одна строка =
      // один клиент). НЕ разворачиваем их заново в pending-строки по детям — иначе
      // ребёнок, которого фоллбэк NULL-строки показывает на детали кампании
      // (pickWard в page.tsx), задвоится с новой pending-строкой: «один ребёнок —
      // две строки, одна обработанная, вторая нет». Прогресс закрытого контакта
      // при этом сохраняется (обработанные строки удаляются/меняются ниже — нет).
      const clientsWithProcessedNullRow = new Set<string>()
      for (const it of existing) {
        if (it.wardId === null && it.status !== "pending") {
          clientsWithProcessedNullRow.add(it.clientId)
        }
      }

      // Желаемое разложение по подопечным для КАЖДОГО нужного клиента.
      //  - base/tasks: по ТЕКУЩИМ детям подходящих клиентов (снимок «оживает»);
      //  - no_answer: пары (клиент, подопечный) из no_answer-позиций других кампаний
      //    (грузим здесь, под advisory-локом, в scope нажавшего, исключая себя).
      let desiredWardsByClient: Map<string, Set<string | null>>
      if (isNoAnswer) {
        desiredWardsByClient = await loadNoAnswerDesiredRows(tx, tenantId, scope, id)
      } else {
        desiredWardsByClient = new Map<string, Set<string | null>>()
        for (const c of matching) {
          const appWardIds = stage
            ? (c as { applications?: { wardId: string | null }[] }).applications?.map((a) => a.wardId)
            : undefined
          desiredWardsByClient.set(c.id, new Set(wardIdsForClient(c.wards, fc, undefined, appWardIds)))
        }
      }
      const matchingIds = new Set(desiredWardsByClient.keys())

      const toAddRows: {
        tenantId: string; campaignId: string; clientId: string
        wardId: string | null; status: "pending"
      }[] = []
      for (const [clientId, desired] of desiredWardsByClient) {
        // Обработанного легаси-клиента (NULL-строка с результатом) не дораскрываем
        // в детей — см. clientsWithProcessedNullRow: иначе задвоение строки ребёнка.
        if (clientsWithProcessedNullRow.has(clientId)) continue
        const have = existingWardsByClient.get(clientId) ?? new Set<string | null>()
        for (const wardId of desired) {
          if (!have.has(wardId)) {
            toAddRows.push({ tenantId, campaignId: id, clientId, wardId, status: "pending" })
          }
        }
      }

      // Кандидаты на удаление — только НЕобработанные (pending) позиции в scope
      // нажавшего, которые больше не нужны: клиент выпал из критериев ЛИБО
      // подопечный строки больше не в желаемом наборе (ребёнок удалён; либо у
      // бывшего бездетного клиента появились дети — плейсхолдер ward=null заменяем
      // строками-детьми). Обработанные позиции сохраняются ВСЕГДА.
      //
      // «Обзвон по не ответившим» (isNoAnswer) — ИСКЛЮЧЕНИЕ: refresh только ДОБАВЛЯЕТ
      // новых не ответивших и НИКОГО не удаляет (Денис, 17.08). Тех, кому с тех пор
      // дозвонились в исходном обзвоне (выпали из источника no_answer), из этой
      // кампании НЕ убираем — они остаются со статусом, который им поставит оператор.
      // Удаление pending-«переставших подходить» осмысленно только для обзвона по
      // базам/задачам (выпадение из критериев), не для среза не ответивших.
      let toRemoveIds: string[] = []
      if (!isNoAnswer) {
        const pendingInScope = await tx.callCampaignItem.findMany({
          where: { campaignId: id, tenantId, status: "pending", client: scopeClientByBranch(scope) },
          select: { id: true, clientId: true, wardId: true },
        })
        toRemoveIds = pendingInScope
          .filter((i) => {
            if (!matchingIds.has(i.clientId)) return true
            const desired = desiredWardsByClient.get(i.clientId)
            return !!desired && !desired.has(i.wardId)
          })
          .map((i) => i.id)
      }

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
