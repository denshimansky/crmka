/**
 * Резолвер цены направления по дате (баг #88).
 *
 * Модель: базовые поля `Direction.*` — «живая» текущая цена (крон-промоутер
 * `lib/cron/promote-direction-prices.ts` держит их актуальными). Будущие изменения
 * лежат отдельными строками `DirectionPrice` — полный снимок прайс-блока с датой
 * вступления `effectiveFrom`.
 *
 * Точки создания абонемента (bulk-renew, конвертация заявки, POST /api/subscriptions)
 * резолвят цену по `Subscription.startDate`, заглядывая в ещё НЕ промоутнутые
 * будущие версии: абонемент на сентябрь выписывается в августе — до того как крон
 * промоутит сентябрьскую цену в базу. Уже созданные абонементы несут слепок цены и
 * не пересчитываются.
 *
 * Сравнение — строго по календарному дню в UTC (`dayNumUtc`), чтобы граница даты не
 * плыла от таймзоны сервера. Дата старта из точек создания приводится к UTC-дню через
 * `toUtcDay`; `effectiveFrom` хранится как UTC-полночь и сравнивается напрямую.
 *
 * Единственная точка правды — не дублировать логику выбора версии в роутах/формах.
 */

export type DirectionPriceFields = {
  lessonPrice: number | string | { toString(): string }
  trialPrice?: number | string | { toString(): string } | null
  trialFree?: boolean | null
  singleVisitPrice?: number | string | { toString(): string } | null
  packagePrices?: Record<string, number> | null | unknown
}

export type DirectionPriceVersionInput = DirectionPriceFields & {
  effectiveFrom: Date | string
  appliedAt?: Date | string | null
  deletedAt?: Date | string | null
}

export type ResolvedDirectionPrice = {
  lessonPrice: number
  trialPrice: number | null
  trialFree: boolean
  singleVisitPrice: number | null
  packagePrices: Record<string, number> | null
}

/** Календарный день даты как число (UTC-полночь) — для стабильного сравнения границ. */
export function dayNumUtc(d: Date | string): number {
  const date = d instanceof Date ? d : new Date(d)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Локальный календарный день → та же дата как UTC-полночь. Точки создания строят
 * `startDate` через локальные геттеры (`new Date(year, month-1, 1)`), поэтому перед
 * резолвом приводим к UTC-дню, чтобы сравнение с `effectiveFrom` (UTC) не плыло.
 */
export function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function packagePricesOrNull(v: unknown): Record<string, number> | null {
  return v && typeof v === "object" ? (v as Record<string, number>) : null
}

function normalize(f: DirectionPriceFields): ResolvedDirectionPrice {
  return {
    lessonPrice: Number(f.lessonPrice),
    trialPrice: numOrNull(f.trialPrice ?? null),
    trialFree: !!f.trialFree,
    singleVisitPrice: numOrNull(f.singleVisitPrice ?? null),
    packagePrices: packagePricesOrNull(f.packagePrices),
  }
}

/**
 * Цена направления, действующая на дату `atDate`. Среди НЕ промоутнутых
 * (`appliedAt == null`), неудалённых (`deletedAt == null`) версий с
 * `effectiveFrom <= atDate` берётся ближайшая слева (максимальный `effectiveFrom`);
 * если таких нет — базовые поля направления.
 *
 * Возвращаемый объект совместим с `PricedDirection` из `package-price.ts`, поэтому
 * пакетная цена версии считается как `packageLessonPrice(directionPriceAt(...), tplId)`.
 */
export function directionPriceAt(
  base: DirectionPriceFields,
  versions: DirectionPriceVersionInput[] | null | undefined,
  atDate: Date,
): ResolvedDirectionPrice {
  const at = dayNumUtc(atDate)
  let best: DirectionPriceVersionInput | null = null
  let bestDay = -Infinity
  for (const v of versions ?? []) {
    if (v.appliedAt != null || v.deletedAt != null) continue
    const day = dayNumUtc(v.effectiveFrom)
    if (day <= at && day > bestDay) {
      best = v
      bestDay = day
    }
  }
  return normalize(best ?? base)
}
