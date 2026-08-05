import type { ExpenseRecognitionMode } from "@prisma/client"

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Сколько из выплаты сотруднику признать окладом в ОПИУ (твин-Expense).
 *
 * Оклад — известная фикс-величина (Employee.monthlySalary). В ОПИУ он признаётся
 * ПО ФАКТУ выплаты, но НЕ больше месячного оклада за период (потолок). Потолок:
 *  • не даёт премии / переплате / авансу раздуть статью «Зарплата окладников»;
 *  • у совмещающего (оклад + сделка) отсекает сделочную часть выплаты — сделка в
 *    ОПИУ начисляется ОТДЕЛЬНО из посещений (Attendance.instructorPayAmount),
 *    поэтому без потолка она задвоилась бы.
 * Логика kind-независима: даёт корректный твин из любого диалога выплаты
 * (карточка «Выплатить остатки», вкладки «Оклады»/«Сдельная», legacy).
 *
 * @returns min(paymentTotal, max(0, monthlySalary − alreadyTwinned)), не меньше 0.
 */
export function computeOkladTwinPortion(input: {
  monthlySalary: number
  paymentTotal: number
  alreadyTwinned: number
}): number {
  const remaining = Math.max(0, r2(input.monthlySalary - input.alreadyTwinned))
  return Math.max(0, r2(Math.min(input.paymentTotal, remaining)))
}

/**
 * Сумма НЕ-сделочной ЗП окладника за период, которую нужно признать в ОПИУ по факту
 * выплаты: оклад + премии − штрафы (SalaryAdjustment). Именно этой величиной, а НЕ
 * голым monthlySalary, капается твин — иначе реальная премия окладнику (напр. «за
 * продажи») теряется в финрезе. Клампится к ≥0 (штраф больше оклада+премии).
 * SalaryAdjustment нигде больше в ОПИУ не суммируется, поэтому двойного счёта нет.
 */
export function okladRecognitionTarget(monthlySalary: number, netAdjustment: number): number {
  return Math.max(0, r2(monthlySalary + netAdjustment))
}

export interface OkladTwinRecognition {
  recognitionMode: ExpenseRecognitionMode
  amortizationStartDate: Date
  amortizationMonths: number
  /** date-якорь Expense = месяц признания (окно выборки расходов ОПИУ). */
  date: Date
}

/**
 * Признание оклад-твина в ОПИУ — ВСЕГДА весь оклад в МЕСЯЦ ПЕРИОДА выплаты
 * (single_period, якорь = 1-е число периода), НЕЗАВИСИМО от даты платежа и выбора
 * режима в форме. Оклад «принадлежит» своему периоду: оклад июля, проведённый в
 * августе, ложится в июльский ОПИУ (в отличие от обычного расхода, где якорь — дата
 * платежа). Детерминированность критична для per-period ресинка: ЛЮБАЯ мутация
 * периода (создание/правка/удаление выплаты) даёт тот же якорь, поэтому признание
 * не «плывёт» и не теряется (amortized/not_in_pnl из формы к окладу неприменимы).
 */
export function okladTwinRecognition(periodYear: number, periodMonth: number): OkladTwinRecognition {
  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1))
  return { recognitionMode: "single_period", amortizationStartDate: periodStart, amortizationMonths: 1, date: periodStart }
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
  directionId: string | null
}

/**
 * Один оклад-твин (accountId=NULL → только ОПИУ, ДДС/кассу двигает сама выплата).
 * Сумма — `amount` (уже с потолком, см. computeOkladTwinPortion); направление —
 * defaultDirection сотрудника (оклад — единая фикс-статья, НЕ разносится по
 * направлениям занятий, в отличие от сделки).
 */
export function buildOkladTwin(input: {
  tenantId: string
  categoryId: string
  salaryPaymentId: string
  amount: number
  directionId: string | null
  recognition: OkladTwinRecognition
  createdBy: string | null
}): OkladTwinExpense {
  return {
    tenantId: input.tenantId,
    categoryId: input.categoryId,
    accountId: null,
    amount: input.amount,
    date: input.recognition.date,
    recognitionMode: input.recognition.recognitionMode,
    amortizationStartDate: input.recognition.amortizationStartDate,
    amortizationMonths: input.recognition.amortizationMonths,
    isVariable: false,
    createdBy: input.createdBy,
    salaryPaymentId: input.salaryPaymentId,
    directionId: input.directionId,
  }
}
