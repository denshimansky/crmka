/**
 * Цена ЗАНЯТИЯ для пакетного абонемента (баг #89).
 *
 * Модель: базовая `Direction.lessonPrice` + необязательные пер-пакетные
 * переопределения `Direction.packagePrices = { packageTemplateId: ценаЗанятия }`.
 * Отсутствие ключа (или невалидное значение, или ключ-сирота от удалённого
 * шаблона) → базовая цена. Единственная точка правды — не хардкодить логику
 * фолбэка в формах/роутах, звать этот хелпер.
 *
 * Итоговая стоимость абонемента считается как обычно: цена × totalLessons.
 */
export type PricedDirection = {
  lessonPrice: number | string | { toString(): string }
  packagePrices?: Record<string, number> | null | unknown
}

export function packageLessonPrice(
  direction: PricedDirection,
  packageTemplateId?: string | null,
): number {
  const base = Number(direction.lessonPrice)
  if (!packageTemplateId) return base
  const map = direction.packagePrices
  if (!map || typeof map !== "object") return base
  const raw = (map as Record<string, unknown>)[packageTemplateId]
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : base
}
