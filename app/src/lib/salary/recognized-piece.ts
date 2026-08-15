// Признание СДЕЛОЧНОЙ ЗП инструкторов в ОПИУ «по выплате, в месяц работы».
//
// Правило владельца: в момент начисления/отметки в ОПИУ ничего не попадает; сделка
// признаётся в ОПИУ в МЕСЯЦ РАБОТЫ (по дате занятия), но только в пределах ФАКТИЧЕСКИ
// ВЫПЛАЧЕННОЙ суммы. Выплата гасит самый ранний неоплаченный месяц работы (FIFO) —
// поэтому доплата за июль, сделанная в августе, наполняет именно июль.
//
// Реализация «на лету» (без материализации расхода и без миграции данных): отчёты ОПИУ
// как и раньше берут сделку из Attendance.instructorPayAmount по дате занятия, но
// домножают её на коэффициент recognizedRatio(payee, месяц) ∈ [0..1] = R[m]/A[m], где
// A[m] — начислено за месяц, R[m] — признанная (оплаченная, по FIFO) часть.
//
// Payroll-отчёты («сколько причитается инструктору»), прогноз и «Прибыльность
// инструктора» остаются на accrual — их этот модуль не касается.

import { db } from "@/lib/db"
import { OKLAD_EXPENSE_CATEGORY_NAME } from "./oklad-category"

/** Ключ месяца: year*12 + (month-1). Совпадает с monthKey из lib/pnl-view. */
export function ymKeyOf(year: number, month1to12: number): number {
  return year * 12 + (month1to12 - 1)
}

/** Ключ месяца из даты (UTC). */
export function ymKeyOfDate(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * FIFO-распределение оплаченной сделки инструктора по месяцам работы (старейший — первым).
 *
 * `windowAccruals` — начисления по месяцам ОКНА отчёта (ymKey → сумма). `priorAccrual` —
 * суммарное начисление ВСЕХ месяцев ДО окна (гасится первым, так что до окна доходит лишь
 * остаток оплаты). Возвращает ratio ∈ [0..1] на каждый месяц окна.
 *
 * Чистая функция — юнит-тестируемая. Вызывается на одного инструктора.
 */
export function allocatePieceFifo(
  windowAccruals: { ymKey: number; accrual: number }[],
  piecePaid: number,
  priorAccrual: number,
): Map<number, number> {
  const ratio = new Map<number, number>()
  // Оплата сначала гасит всё, что начислено до окна; в окно приходит остаток.
  let remaining = Math.max(0, piecePaid - Math.max(0, priorAccrual))
  const sorted = [...windowAccruals].sort((a, b) => a.ymKey - b.ymKey)
  for (const { ymKey, accrual } of sorted) {
    if (accrual <= 0) {
      ratio.set(ymKey, 0)
      continue
    }
    const recognized = Math.min(accrual, remaining)
    remaining -= recognized
    ratio.set(ymKey, recognized / accrual)
  }
  return ratio
}

/**
 * Оплачено именно сделкой = всего выплачено − признанный оклад (сумма оклад-твинов).
 * Так сделка = «всё, что сверх оклада» → оклад не задваивается между твином и сделкой.
 */
export function computePiecePaid(totalPaid: number, okladRecognized: number): number {
  return Math.max(0, totalPaid - Math.max(0, okladRecognized))
}

type AccrualRow = { payee: string; y: number; mo: number; amount: number }

/**
 * Строит карту коэффициентов признания сделки: employeeId → (ymKey → ratio) для месяцев
 * окна [windowStart..windowEnd]. Считается по всей сети (branch-агностично): доля оплаты
 * инструктора наполняет его начисления помесячно, а срез филиала в отчёте берёт свою часть
 * из уже отмасштабированных сумм.
 *
 *  • Начислено по (payee, месяц)  — агрегат Attendance (payEnabled) по дате занятия, всё ≤ окна.
 *  • Оплачено сделкой (всего)      — Σ SalaryPayment.amount − Σ оклад-твинов инструктора
 *    (твин = Expense.salaryPaymentId, категория «Зарплата окладников»). Так сделка = всё,
 *    что сверх оклада, и модель не расходится с оклад-твином (единый источник правды).
 *  • FIFO по месяцам → ratio.
 */
export async function loadPieceRatioMap(
  tenantId: string,
  windowStartYmKey: number,
  windowEndYmKey: number,
): Promise<Map<string, Map<number, number>>> {
  // Граница окна как строгий верх «< 1-е число следующего месяца» (::date) — без
  // tz-неоднозначности при сравнении date-колонки в raw SQL.
  const nextKey = windowEndYmKey + 1
  const nextMonthFirst = `${Math.floor(nextKey / 12)}-${String((nextKey % 12) + 1).padStart(2, "0")}-01`

  const [accrualRows, paidRows, twins] = await Promise.all([
    // Начисления по (payee, год, месяц) — агрегат в БД (дёшево: строк ~ инструкторы×месяцы).
    db.$queryRaw<AccrualRow[]>`
      SELECT COALESCE(l.substitute_instructor_id, l.instructor_id)::text AS payee,
             EXTRACT(YEAR FROM l.date)::int  AS y,
             EXTRACT(MONTH FROM l.date)::int AS mo,
             SUM(a.instructor_pay_amount)::float8 AS amount
      FROM attendances a
      JOIN lessons l ON l.id = a.lesson_id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.instructor_pay_enabled = true
        AND l.date < ${nextMonthFirst}::date
        AND COALESCE(l.substitute_instructor_id, l.instructor_id) IS NOT NULL
      GROUP BY payee, y, mo
    `,
    // Всего выплачено по инструктору (все периоды).
    db.salaryPayment.groupBy({
      by: ["employeeId"],
      where: { tenantId },
      _sum: { amount: true },
    }),
    // Оклад-твины (Expense с salaryPaymentId, системная категория оклада) → сумма оклада.
    db.expense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        salaryPaymentId: { not: null },
        category: { name: OKLAD_EXPENSE_CATEGORY_NAME },
      },
      select: { amount: true, salaryPayment: { select: { employeeId: true } } },
    }),
  ])

  const totalPaidByEmp = new Map<string, number>()
  for (const p of paidRows) totalPaidByEmp.set(p.employeeId, Number(p._sum.amount ?? 0))

  const okladByEmp = new Map<string, number>()
  for (const t of twins) {
    const empId = t.salaryPayment?.employeeId
    if (!empId) continue
    okladByEmp.set(empId, (okladByEmp.get(empId) ?? 0) + Number(t.amount))
  }

  // Группируем начисления по инструктору: prior (до окна) суммой + месяцы окна.
  const perEmp = new Map<string, { prior: number; window: { ymKey: number; accrual: number }[] }>()
  for (const r of accrualRows) {
    const ymKey = ymKeyOf(r.y, r.mo)
    let e = perEmp.get(r.payee)
    if (!e) {
      e = { prior: 0, window: [] }
      perEmp.set(r.payee, e)
    }
    if (ymKey < windowStartYmKey) e.prior += r.amount
    else if (ymKey <= windowEndYmKey) e.window.push({ ymKey, accrual: r.amount })
  }

  const result = new Map<string, Map<number, number>>()
  for (const [empId, { prior, window }] of perEmp) {
    const piecePaid = computePiecePaid(totalPaidByEmp.get(empId) ?? 0, okladByEmp.get(empId) ?? 0)
    result.set(empId, allocatePieceFifo(window, piecePaid, prior))
  }
  return result
}

/**
 * Удобный резолвер: (payee, дата занятия) → ratio ∈ [0..1]. Неизвестный ключ → 1
 * (fail-open к прежнему поведению; для реальной payEnabled-отметки ключ всегда есть,
 * т.к. агрегат начислений строится из тех же отметок).
 */
export function makeRatioLookup(map: Map<string, Map<number, number>>) {
  return (employeeId: string | null | undefined, lessonDate: Date): number => {
    if (!employeeId) return 1
    const r = map.get(employeeId)?.get(ymKeyOfDate(lessonDate))
    return r === undefined ? 1 : r
  }
}
