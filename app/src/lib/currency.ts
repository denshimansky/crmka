/**
 * Валюта расчёта организации — ТОЛЬКО отображение символа/формата, без пересчёта
 * сумм по курсу. Суммы хранятся и считаются в одной валюте организации; смена
 * валюты меняет лишь символ (₽ → ₸/сўм/₴ …) и подпись. Числовой формат общий —
 * ru-RU (пробел-разделитель тысяч), чтобы вид сумм не менялся между странами.
 *
 * Дефолт — рубль РФ. Существующие организации остаются на RUB, пока владелец
 * вручную не переключит валюту в «Настройки → Организация» или в запросе на
 * дашборде (для новых организаций).
 */

export interface CurrencyInfo {
  /** ISO-код (ключ, хранится в organization.currency). */
  code: string
  /** Символ для отображения рядом с суммой. */
  symbol: string
  /** Подпись для селектора. */
  label: string
}

/** Популярные валюты стран СНГ (RUB — дефолт, первым). */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "RUB", symbol: "₽", label: "Российский рубль (₽)" },
  { code: "KZT", symbol: "₸", label: "Казахстанский тенге (₸)" },
  { code: "BYN", symbol: "Br", label: "Белорусский рубль (Br)" },
  { code: "UAH", symbol: "₴", label: "Украинская гривна (₴)" },
  { code: "UZS", symbol: "сўм", label: "Узбекский сум (сўм)" },
  { code: "KGS", symbol: "сом", label: "Киргизский сом (сом)" },
  { code: "AZN", symbol: "₼", label: "Азербайджанский манат (₼)" },
  { code: "AMD", symbol: "֏", label: "Армянский драм (֏)" },
  { code: "GEL", symbol: "₾", label: "Грузинский лари (₾)" },
  { code: "TJS", symbol: "смн", label: "Таджикский сомони (смн)" },
  { code: "TMT", symbol: "m", label: "Туркменский манат (m)" },
  { code: "MDL", symbol: "L", label: "Молдавский лей (L)" },
]

export const DEFAULT_CURRENCY = "RUB"

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return !!code && BY_CODE.has(code)
}

/** Символ валюты по коду; неизвестный/пустой код → символ рубля. */
export function currencySymbol(code?: string | null): string {
  return (code && BY_CODE.get(code)?.symbol) || BY_CODE.get(DEFAULT_CURRENCY)!.symbol
}

export interface FormatMoneyOptions {
  /** Число знаков после запятой (по умолчанию 0 — округление до целого). */
  decimals?: number
}

/**
 * Форматирует сумму с символом валюты организации: «1 234 ₽», «1 234 ₸».
 * Число форматируется в ru-RU (пробел-разделитель тысяч); опция decimals — для
 * мест, где нужны копейки (по умолчанию округляем до целого, как в большинстве
 * денежных виджетов).
 */
export function formatMoney(
  amount: number,
  currency?: string | null,
  opts?: FormatMoneyOptions,
): string {
  const decimals = opts?.decimals ?? 0
  const value = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(decimals === 0 ? Math.round(amount) : amount)
  return `${value} ${currencySymbol(currency)}`
}
