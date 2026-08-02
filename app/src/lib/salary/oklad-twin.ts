import type { ExpenseRecognitionMode } from "@prisma/client"

export interface OkladTwinItem {
  directionId: string | null
  amount: number
}

export interface BuildOkladTwinInput {
  tenantId: string
  categoryId: string
  salaryPaymentId: string
  date: Date
  recognitionMode: ExpenseRecognitionMode
  amortizationStartDate: Date | null
  amortizationMonths: number | null
  createdBy: string | null
  items: OkladTwinItem[]
}

export interface OkladTwinExpense {
  tenantId: string
  categoryId: string
  accountId: null
  amount: number
  date: Date
  recognitionMode: ExpenseRecognitionMode
  amortizationStartDate: Date | null
  amortizationMonths: number | null
  isVariable: false
  createdBy: string | null
  salaryPaymentId: string
  /** для ExpenseBranch (прямое разнесение расхода по направлению в ОПИУ) */
  directionId: string | null
}

/**
 * Позиции ОДНОЙ оклад-выплаты (одного сотрудника) → твин-расходы: одна строка
 * Expense на каждое направление (directionId), сумма = Σ позиций направления.
 * accountId=NULL → расход только для ОПИУ (ДДС даёт сама SalaryPayment).
 */
export function buildOkladTwinExpenses(input: BuildOkladTwinInput): OkladTwinExpense[] {
  const byDirection = new Map<string | null, number>()
  for (const it of input.items) {
    const key = it.directionId ?? null
    byDirection.set(key, (byDirection.get(key) ?? 0) + it.amount)
  }
  const out: OkladTwinExpense[] = []
  for (const [directionId, amount] of byDirection.entries()) {
    out.push({
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      accountId: null,
      amount,
      // date = ЯКОРЬ признания в ОПИУ, а не дата выплаты. Твин не участвует в ДДС
      // (accountId=NULL), поэтому date служит только окном выборки расходов в P&L.
      // Отчёты тянут расходы по `date <= конец_месяца`, а признание может быть в
      // ПРОШЛОМ месяце относительно выплаты (ЗП июля выплачена в августе → ОПИУ июль).
      // Ставим date = месяц признания (amortizationStartDate), иначе будущий по дате
      // выплаты твин не попадёт в окно своего месяца признания и оклад исчезнет из ОПИУ.
      date: input.amortizationStartDate ?? input.date,
      recognitionMode: input.recognitionMode,
      amortizationStartDate: input.amortizationStartDate,
      amortizationMonths: input.amortizationMonths,
      isVariable: false,
      createdBy: input.createdBy,
      salaryPaymentId: input.salaryPaymentId,
      directionId,
    })
  }
  return out
}
