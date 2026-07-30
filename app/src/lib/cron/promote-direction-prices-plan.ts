import { dayNumUtc, toUtcDay } from "@/lib/subscriptions/direction-price"

/**
 * Чистая логика планирования промоутинга цен направлений (баг #88) — без БД,
 * чтобы покрывалось unit-тестами. Async-обёртка с БД — promote-direction-prices.ts.
 */

export type PromotableVersion = {
  id: string
  directionId: string
  effectiveFrom: Date
  appliedAt: Date | null
  deletedAt: Date | null
}

export type PlannedPromotion<T extends PromotableVersion> = {
  directionId: string
  /** Версия, чей снимок копируется в базовые поля направления (макс. effectiveFrom среди due). */
  winner: T
  /** Все due-версии направления — помечаются appliedAt (промежуточные не влияют на базу, но не должны висеть). */
  appliedIds: string[]
}

/**
 * «Что промоутить сегодня»: due = `effectiveFrom <= сегодня` (по UTC-дню),
 * `appliedAt == null`, `deletedAt == null`. На каждое направление — победитель с
 * максимальным `effectiveFrom`; все due-версии направления попадают в `appliedIds`.
 */
export function planPromotions<T extends PromotableVersion>(
  versions: T[],
  now: Date,
): PlannedPromotion<T>[] {
  const today = dayNumUtc(toUtcDay(now))
  const byDir = new Map<string, T[]>()
  for (const v of versions) {
    if (v.appliedAt != null || v.deletedAt != null) continue
    if (dayNumUtc(v.effectiveFrom) > today) continue
    const arr = byDir.get(v.directionId) ?? []
    arr.push(v)
    byDir.set(v.directionId, arr)
  }
  const out: PlannedPromotion<T>[] = []
  for (const [directionId, arr] of byDir) {
    let winner = arr[0]
    for (const v of arr) {
      if (dayNumUtc(v.effectiveFrom) > dayNumUtc(winner.effectiveFrom)) winner = v
    }
    out.push({ directionId, winner, appliedIds: arr.map((v) => v.id) })
  }
  return out
}
