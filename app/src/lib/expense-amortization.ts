/**
 * Раскладка расхода по месяцам ОПИУ.
 *
 * В ДДС расход всегда учитывается одной суммой по дате платежа (`expense.date`).
 * В ОПИУ — по периоду признания: либо в месяц платежа, либо в один указанный месяц
 * («аренда июня уплачена 25 мая»), либо равномерно по N месяцам начиная с указанной
 * даты («принтер 30 000 на 3 месяца → 10 000/мес»).
 */

import type { ExpenseRecognitionMode } from "@prisma/client"

export interface ExpenseLike {
  amount: number | { toString(): string }
  date: Date
  recognitionMode: ExpenseRecognitionMode
  amortizationMonths: number | null
  amortizationStartDate: Date | null
}

export interface MonthAmount {
  /** 4-значный год */
  year: number
  /** 1..12 */
  month: number
  /** сумма в рублях, два знака после запятой */
  amount: number
}

const MAX_AMORTIZATION_MONTHS = 60

function toNumber(v: number | { toString(): string }): number {
  return typeof v === "number" ? v : Number(v.toString())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function ymOf(d: Date): { year: number; month: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/**
 * Разворачивает расход в массив строк «месяц → сумма ОПИУ». ДДС эти строки не использует.
 *
 * Гарантии:
 *  - сумма всех строк равна `expense.amount` (с округлением до копеек, излишек/нехватка
 *    компенсируется в последнем месяце);
 *  - всегда возвращается ≥ 1 элемент, КРОМЕ режима not_in_pnl (см. ниже);
 *  - для некорректных конфигураций (recognitionMode = amortized без `amortizationStartDate`
 *    или с `amortizationMonths ≤ 0`) откат к режиму by_payment_date.
 *
 * Режим not_in_pnl: расход не признаётся в ОПИУ/финрезе вообще — возвращаем []. ДДС
 * на это не смотрит (он считает по `date`+`amount`), поэтому деньги всё равно учтены.
 */
export function expandExpenseToMonths(e: ExpenseLike): MonthAmount[] {
  // Не учитывать в финрезе — ноль строк ОПИУ.
  if (e.recognitionMode === "not_in_pnl") return []

  const total = round2(toNumber(e.amount))

  if (e.recognitionMode === "single_period") {
    const start = e.amortizationStartDate ?? e.date
    const ym = ymOf(start)
    return [{ ...ym, amount: total }]
  }

  if (e.recognitionMode === "amortized") {
    const months = e.amortizationMonths ?? 0
    const start = e.amortizationStartDate
    if (months > 0 && months <= MAX_AMORTIZATION_MONTHS && start) {
      const per = round2(total / months)
      const out: MonthAmount[] = []
      let distributed = 0
      for (let i = 0; i < months; i++) {
        const y = start.getUTCFullYear()
        const m0 = start.getUTCMonth() + i
        const year = y + Math.floor(m0 / 12)
        const month = (m0 % 12) + 1
        const amount = i === months - 1 ? round2(total - distributed) : per
        distributed = round2(distributed + per)
        out.push({ year, month, amount })
      }
      return out
    }
    // некорректные данные — откат на by_payment_date
  }

  // by_payment_date (default) или fallback
  const ym = ymOf(e.date)
  return [{ ...ym, amount: total }]
}

/**
 * Сумма частей расхода, попадающих в окно `[fromY-fromM, toY-toM]` (включительно).
 * Возвращает 0, если ни одна часть не попадает.
 */
export function expenseAmountInWindow(
  e: ExpenseLike,
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number,
): number {
  const fromKey = fromYear * 12 + (fromMonth - 1)
  const toKey = toYear * 12 + (toMonth - 1)
  let sum = 0
  for (const slice of expandExpenseToMonths(e)) {
    const k = slice.year * 12 + (slice.month - 1)
    if (k >= fromKey && k <= toKey) sum += slice.amount
  }
  return round2(sum)
}

/**
 * Сколько месяцев назад от `dateFrom` нужно выбрать расходы, чтобы все амортизации,
 * затрагивающие окно `[dateFrom, dateTo]`, попали в выборку. Возвращает максимум —
 * фактический MAX_AMORTIZATION_MONTHS (= UI-лимит). При выборке расходов используется как:
 *   `expense.date >= subMonths(dateFrom, AMORTIZATION_LOOKBACK_MONTHS)`.
 */
export const AMORTIZATION_LOOKBACK_MONTHS = MAX_AMORTIZATION_MONTHS
