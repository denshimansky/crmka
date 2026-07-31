import { dayNumUtc } from "@/lib/subscriptions/direction-price"

export type Dated = {
  effectiveFrom: Date | string
  deletedAt?: Date | string | null
}

/**
 * Выбирает действующую на дату версию ставки: среди неудалённых `schedules`
 * с effectiveFrom <= atDate берёт с максимальным effectiveFrom; если таких нет —
 * base. Сравнение по календарному UTC-дню (dayNumUtc из direction-price #88).
 * Чистая функция — юнит-тесты без БД (по образцу directionPriceAt).
 */
export function pickRateAt<B, S extends Dated>(
  base: B,
  schedules: S[] | null | undefined,
  atDate: Date,
): B | S {
  const at = dayNumUtc(atDate)
  let best: S | null = null
  let bestDay = -Infinity
  for (const s of schedules ?? []) {
    if (s.deletedAt != null) continue
    const day = dayNumUtc(s.effectiveFrom)
    if (day <= at && day > bestDay) {
      best = s
      bestDay = day
    }
  }
  return best ?? base
}
