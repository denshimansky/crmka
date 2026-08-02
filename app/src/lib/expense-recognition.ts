// Единый маппинг блока «Как провести в ОПИУ» → поля Expense (recognitionMode +
// amortization*). Используется формой расхода и формами выплаты оклада (твин).
// Дублирует то, что раньше жило инлайном в add-expense-dialog.tsx:171-184.

export type RecognitionMode = "by_payment_date" | "single_period" | "amortized" | "not_in_pnl"

export interface RecognitionInput {
  recognitionMode: RecognitionMode
  /** "YYYY-MM" — месяц признания для single_period */
  singleMonth: string
  /** "YYYY-MM" — стартовый месяц для amortized */
  amortStartMonth: string
  /** строка из <input type=number>, для amortized */
  amortMonths: string
}

export interface RecognitionPayload {
  recognitionMode: RecognitionMode
  /** "YYYY-MM-01" либо undefined */
  amortizationStartDate: string | undefined
  amortizationMonths: number | undefined
}

/** Бросает Error с RU-сообщением, если amortized-месяцы вне 2..60. */
export function resolveRecognition(input: RecognitionInput): RecognitionPayload {
  if (input.recognitionMode === "single_period") {
    return {
      recognitionMode: "single_period",
      amortizationStartDate: `${input.singleMonth}-01`,
      amortizationMonths: 1,
    }
  }
  if (input.recognitionMode === "amortized") {
    const n = Number(input.amortMonths)
    if (!Number.isFinite(n) || n < 2 || n > 60) {
      throw new Error("Количество месяцев должно быть от 2 до 60")
    }
    return {
      recognitionMode: "amortized",
      amortizationStartDate: `${input.amortStartMonth}-01`,
      amortizationMonths: n,
    }
  }
  // by_payment_date | not_in_pnl — amortization-поля не нужны.
  return { recognitionMode: input.recognitionMode, amortizationStartDate: undefined, amortizationMonths: undefined }
}
