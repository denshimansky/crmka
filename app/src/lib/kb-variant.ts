// Вкладки базы знаний. Держим отдельно от lib/kb.ts (который тянет Prisma),
// чтобы чистое отображение типа абонемента → вкладку можно было юнит-тестировать
// без клиента БД. import type стирается на компиляции — рантайм-зависимости нет.
import type { SubscriptionType } from "@prisma/client"

export type KbVariant = "calendar" | "package"

export const KB_VARIANTS: readonly KbVariant[] = ["calendar", "package"] as const

export const KB_VARIANT_LABELS: Record<KbVariant, string> = {
  calendar: "Календарный",
  package: "Пакетный",
}

/**
 * Какую вкладку базы знаний показать организации по её типу абонемента.
 * package → «Пакетный»; всё остальное (calendar, fixed, «не выбран» = null) →
 * «Календарный». Решение владельца: две вкладки, «Фикс»/невыбранный тип идут
 * в календарную.
 */
export function kbVariantForSubscriptionType(
  type: SubscriptionType | null | undefined,
): KbVariant {
  return type === "package" ? "package" : "calendar"
}

/** Валиден ли строковый variant (для парсинга query/body). */
export function isKbVariant(value: unknown): value is KbVariant {
  return value === "calendar" || value === "package"
}
