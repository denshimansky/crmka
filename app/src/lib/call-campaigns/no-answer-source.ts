import type { Prisma } from "@prisma/client"
import type { BranchScope } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

/**
 * Источник кампании «Обзвон по не ответившим» (filterCriteria.mode="no_answer").
 *
 * Собирает уникальные пары (клиент, подопечный) из позиций ВСЕХ прочих кампаний
 * обзвона, у которых текущий статус = no_answer («Не ответил»). Возвращает карту
 * clientId → набор wardId (включая null-плейсхолдер для бездетной строки) — той же
 * формы, что desiredWardsByClient в refresh-роуте, поэтому одна логика добавления/
 * удаления/актуализации работает и для этого режима.
 *
 * Правила источника:
 *  - только текущий status=no_answer: если контакт позже перезвонили и он ответил
 *    (статус стал application/completed/callback/called) — он из источника выпадает;
 *  - кампания-источник не удалена (deletedAt=null); АРХИВНЫЕ кампании включаем —
 *    «не ответил» остаётся «не ответившим» независимо от архивации источника;
 *  - исключаем саму кампанию (excludeCampaignId): свои no_answer-строки не должны
 *    самоподдерживать список — их прогресс и так хранится в кампании;
 *  - клиент не удалён и виден в scope филиалов (ADM-04): скоуп-админ соберёт только
 *    своих; владелец/полный доступ — всех.
 *
 * `client` — PrismaClient или транзакционный клиент (refresh зовёт под advisory-локом).
 */
export async function loadNoAnswerDesiredRows(
  client: Prisma.TransactionClient,
  tenantId: string,
  scope: BranchScope,
  excludeCampaignId?: string,
): Promise<Map<string, Set<string | null>>> {
  const items = await client.callCampaignItem.findMany({
    where: {
      tenantId,
      status: "no_answer",
      ...(excludeCampaignId ? { campaignId: { not: excludeCampaignId } } : {}),
      campaign: { deletedAt: null },
      client: { deletedAt: null, ...scopeClientByBranch(scope) },
    },
    select: { clientId: true, wardId: true },
    distinct: ["clientId", "wardId"],
  })

  const map = new Map<string, Set<string | null>>()
  for (const it of items) {
    let s = map.get(it.clientId)
    if (!s) {
      s = new Set<string | null>()
      map.set(it.clientId, s)
    }
    s.add(it.wardId)
  }
  return map
}
