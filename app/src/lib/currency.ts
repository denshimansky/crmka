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
  /** Фиксированное число знаков после запятой. Если не задано — копейки
   *  показываются только когда они есть (0..2 знака, лишние нули отсекаются). */
  decimals?: number
}

/**
 * Форматирует сумму с символом валюты организации: «1 234 ₽», «1 234 ₸».
 * Число форматируется в ru-RU (пробел-разделитель тысяч).
 *
 * По умолчанию копейки показываются ТОЛЬКО когда они есть: «2 900 ₽», но
 * «4 203,5 ₽» и «250,55 ₽». Так вывод не «врёт» округлением дробной цены
 * (напр. 600,5 × 7 = 4203,5, а не 4204). Явная опция decimals фиксирует число
 * знаков (напр. decimals: 2 — всегда копейки; decimals: 0 — округление до целого).
 */
export function formatMoney(
  amount: number,
  currency?: string | null,
  opts?: FormatMoneyOptions,
): string {
  let value: string
  if (opts?.decimals != null) {
    const decimals = opts.decimals
    value = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(decimals === 0 ? Math.round(amount) : amount)
  } else {
    // Округляем до копеек (гасим возможный float-мусор), затем показываем 0..2
    // знака — минимально необходимое: целое остаётся целым, дробь не теряется.
    const rounded = Math.round(amount * 100) / 100
    value = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(rounded)
  }
  return `${value} ${currencySymbol(currency)}`
}
