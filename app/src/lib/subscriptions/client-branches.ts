// Баг #79: мультифилиальность клиента — два последних РАЗНЫХ филиала абонементов.
//
// Модель: у клиента денормализованы два филиала:
//   - lastBranchId — филиал последнего выписанного абонемента;
//   - prevBranchId — филиал предыдущего РАЗЛИЧНОГО абонемента.
// Вместе они — «два последних разных филиала». Клиент виден админам обоих
// (см. client-segments.ts, unconditional-правило last/prev), плюс всех
// филиалов, где у него есть живой абонемент (правило «живой абонемент»).
//
// Единственная точка обновления — вызывается при КАЖДОЙ выписке абонемента
// (subscriptions/route.ts, bulk-renew.ts, wards/move-to-awaiting-payment).
// Порядок «выписки» = момент создания абонемента; при выписке нового филиала
// сдвигаем: prev := старый last, last := новый филиал. Тот же филиал подряд
// (история 1→2→2) prev не меняет, поэтому prev = два последних РАЗНЫХ филиала.

import type { Prisma } from "@prisma/client"

/**
 * Пересчитать пару филиалов после выписки абонемента в `newBranchId`.
 * Чистая функция — тестируется без БД.
 */
export function shiftClientBranches(
  current: { lastBranchId: string | null; prevBranchId: string | null },
  newBranchId: string,
): { lastBranchId: string; prevBranchId: string | null } {
  // Тот же филиал, что и последний, — набор двух разных филиалов не меняется.
  if (current.lastBranchId === newBranchId) {
    return { lastBranchId: newBranchId, prevBranchId: current.prevBranchId }
  }
  // Новый филиал отличается — сдвигаем: предыдущим становится бывший последний.
  return { lastBranchId: newBranchId, prevBranchId: current.lastBranchId }
}

/**
 * Прочитать текущую пару филиалов клиента и вернуть новую после выписки
 * абонемента в `newBranchId`. Результат раскрывается в data: {...} апдейта
 * клиента у места выписки (там же обычно инкремент totalSubscriptionsCount).
 */
export async function computeIssuedBranches(
  tx: Prisma.TransactionClient,
  clientId: string,
  newBranchId: string,
): Promise<{ lastBranchId: string; prevBranchId: string | null }> {
  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: { lastBranchId: true, prevBranchId: true },
  })
  return shiftClientBranches(
    client ?? { lastBranchId: null, prevBranchId: null },
    newBranchId,
  )
}

/**
 * Два последних РАЗНЫХ филиала из списка филиалов абонементов, упорядоченного
 * от нового к старому. Пакетный эквивалент повторного shiftClientBranches —
 * для пересчёта из истории (мердж клиентов, бэкфилл). Чистая функция.
 */
export function twoRecentDistinctBranches(
  branchIdsNewestFirst: Array<string | null>,
): { lastBranchId: string | null; prevBranchId: string | null } {
  const distinct: string[] = []
  for (const b of branchIdsNewestFirst) {
    if (!b) continue
    if (!distinct.includes(b)) distinct.push(b)
    if (distinct.length === 2) break
  }
  return { lastBranchId: distinct[0] ?? null, prevBranchId: distinct[1] ?? null }
}

/**
 * Пересчитать пару филиалов клиента из фактической истории абонементов
 * (по дате выписки createdAt, от новых к старым). Используется там, где
 * инкрементального сдвига мало: слияние клиентов, бэкфилл существующих данных.
 */
export async function recomputeClientBranchesFromHistory(
  tx: Prisma.TransactionClient,
  clientId: string,
): Promise<{ lastBranchId: string | null; prevBranchId: string | null }> {
  const subs = await tx.subscription.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { group: { select: { branchId: true } } },
  })
  return twoRecentDistinctBranches(subs.map((s) => s.group?.branchId ?? null))
}
