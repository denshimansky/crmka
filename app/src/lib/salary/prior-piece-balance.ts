// «Доначислено» — накопленный СДЕЛОЧНЫЙ остаток сотрудника за все периоды ДО
// выбранного месяца: (начислено по занятиям + сделочные премии − сделочные штрафы
// − сделочные выплаты). Плюс = недоплата прошлых месяцев (в т.ч. ретро-отметки
// «Прогул»/перерасчёты, появившиеся после выплаты периода), минус = переплата.
//
// Модель самосогласована: «К выплате» текущего месяца = Доначислено + остаток
// месяца. Выплата тегируется текущим месяцем, а Доначислено следующего месяца =
// Σ всех периодов ДО него, куда эта выплата уже входит → прошлый долг гасится сам.
//
// Разделение сделка/оклад — тем же `kindOfDirection` (оклад = «без направления» у
// окладника). Поэтому позиция выплаты «доначисления» должна нести НЕнулевое
// направление (piece), иначе у совместителя она классифицируется как оклад и долг
// не гасится — для этого возвращаем topDirectionId (направление с наибольшим
// сделочным начислением прошлых периодов).

import type { PrismaClient } from "@prisma/client"
import { kindOfDirection } from "./kind-split"
import { okladForPeriod, type OkladVersion } from "./oklad-for-period"
import { loadOkladSchedules } from "./oklad-context"

const r2 = (n: number) => Math.round(n * 100) / 100

export interface PriorPieceOne {
  /** Признак «окладник» по умолчанию, если строка не несёт свой (обратная совместимость). */
  hasOklad: boolean
  /** Σ сделочного начисления по занятиям прошлых периодов (с учётом подмены). */
  priorAttendancePay: number
  // hasOklad У СТРОКИ — окладник ли сотрудник был В ПЕРИОДЕ этой строки. Один флаг на
  // всю историю врал после смены оклада: сотрудник с окладом 0 «сейчас» получал
  // hasOklad=false задним числом, и его окладные выплаты/списания прошлых месяцев
  // уезжали в сделочный остаток (кейс Андреевой: −36 000 ₽ из ниоткуда).
  adjustments: { directionId: string | null; type: "bonus" | "penalty"; amount: number; hasOklad?: boolean }[]
  payments: { directionId: string | null; amount: number; hasOklad?: boolean }[]
}

/** Чистый расчёт накопленного сделочного остатка прошлых периодов (плюс/минус). */
export function computePriorPieceBalanceOne(input: PriorPieceOne): number {
  let bonuses = 0
  let penalties = 0
  let paid = 0
  for (const a of input.adjustments) {
    if (kindOfDirection(a.directionId, a.hasOklad ?? input.hasOklad) !== "piece") continue
    if (a.type === "bonus") bonuses += a.amount
    else penalties += a.amount
  }
  for (const p of input.payments) {
    if (kindOfDirection(p.directionId, p.hasOklad ?? input.hasOklad) !== "piece") continue
    paid += p.amount
  }
  return r2(input.priorAttendancePay + bonuses - penalties - paid)
}

export interface PriorPieceResult {
  /** Накопленный сделочный остаток прошлых периодов (плюс/минус). */
  balance: number
  /** Направление с наибольшим сделочным начислением прошлых периодов (для позиции
   *  выплаты «доначисления»); null — если сделочных направлений в прошлом нет. */
  topDirectionId: string | null
  /**
   * Накопленный ОКЛАДНЫЙ остаток прошлых периодов (плюс = недоплата, минус =
   * переплата). Считается так же, как сделочный, но по окладной части:
   * Σ (оклад периода + окладные премии − окладные штрафы − окладные выплаты).
   *
   * Окно начинается либо с даты начала оклада (okladFrom / первая версия), либо —
   * если её нет — с первого месяца, в котором по сотруднику вообще была зарплатная
   * операция. Иначе у окладника без даты начала «долг» уходил бы в бесконечность:
   * оклад формально начисляется за любой прошлый месяц.
   */
  okladBalance: number
}

/** Номер месяца от начала эры — для сравнения и перебора периодов. */
export const ymNum = (y: number, m: number) => y * 12 + (m - 1)

/** Ограничитель окна накопления оклада (5 лет) — страховка от кривых дат начала. */
const MAX_OKLAD_MONTHS = 60

export interface PriorOkladOne {
  monthlySalary: number
  okladFrom: Date | null
  schedule: OkladVersion[]
  /** Первый месяц с любой зарплатной операцией (ymNum) — нижняя граница окна. */
  firstActivityYm: number | null
  /** Последний ПРОШЛЫЙ месяц включительно (ymNum). */
  endYm: number
  /** Окладные премии−штрафы по периодам: ymNum → сумма со знаком. */
  adjByPeriod?: Map<number, number>
  /** Окладные выплаты по периодам: ymNum → сумма. */
  paidByPeriod?: Map<number, number>
}

/**
 * Накопленный ОКЛАДНЫЙ остаток прошлых периодов: Σ (оклад периода + окладные
 * премии − окладные штрафы − окладные выплаты). Плюс = недоплата, минус = переплата.
 *
 * Окно: с даты начала оклада (okladFrom или первая версия), иначе — с первого
 * месяца с зарплатной операцией. Без обеих границ возвращает 0: у окладника без
 * даты начала оклад формально начисляется за ЛЮБОЙ прошлый месяц, и окно ушло бы
 * в бесконечность, нарисовав долг за годы, которых в CRM не было.
 */
export function computePriorOkladBalanceOne(input: PriorOkladOne): number {
  const versions = input.schedule ?? []
  const startDate = input.okladFrom ?? (versions.length > 0 ? versions[0].effectiveFrom : null)
  const startYm = startDate
    ? ymNum(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1)
    : input.firstActivityYm
  if (startYm === null || startYm === undefined || startYm > input.endYm) return 0

  const from = Math.max(startYm, input.endYm - MAX_OKLAD_MONTHS + 1)
  let sum = 0
  for (let ym = from; ym <= input.endYm; ym++) {
    const y = Math.floor(ym / 12)
    const m = (ym % 12) + 1
    const accrued = okladForPeriod({
      monthlySalary: input.monthlySalary,
      okladFrom: input.okladFrom,
      schedule: versions,
      periodYear: y,
      periodMonth: m,
    })
    sum += accrued + (input.adjByPeriod?.get(ym) ?? 0) - (input.paidByPeriod?.get(ym) ?? 0)
  }
  return r2(sum)
}

/**
 * Считает «Доначислено» по сотрудникам за все периоды ДО (year, month).
 * opts.employeeIds — ограничить конкретными сотрудниками (карточка); иначе все.
 */
export async function computePriorPieceBalances(
  dbClient: PrismaClient,
  tenantId: string,
  year: number,
  month: number,
  opts?: { employeeIds?: string[] },
): Promise<Map<string, PriorPieceResult>> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  // «Период раньше выбранного»: год меньше ИЛИ тот же год и месяц меньше.
  const priorPeriodOR = [
    { periodYear: { lt: year } },
    { periodYear: year, periodMonth: { lt: month } },
  ]
  const ids = opts?.employeeIds
  const idFilter = ids ? { in: ids } : undefined

  const [employees, attendances, adjustments, payments] = await Promise.all([
    // Без фильтра deletedAt: строка нужна только чтобы резолвить оклад периода.
    // С фильтром уволенный окладник становился «не окладником», и его окладные
    // выплаты прошлых месяцев уезжали в сделочный остаток огромным минусом.
    dbClient.employee.findMany({
      where: { tenantId, ...(idFilter ? { id: idFilter } : {}) },
      select: { id: true, monthlySalary: true, okladFrom: true },
    }),
    dbClient.attendance.findMany({
      where: {
        tenantId,
        instructorPayEnabled: true,
        lesson: {
          date: { lt: monthStart },
          ...(ids
            ? {
                OR: [
                  { substituteInstructorId: idFilter },
                  { substituteInstructorId: null, instructorId: idFilter },
                ],
              }
            : {}),
        },
      },
      select: {
        instructorPayAmount: true,
        lesson: {
          select: {
            instructorId: true,
            substituteInstructorId: true,
            group: { select: { directionId: true } },
          },
        },
      },
    }),
    dbClient.salaryAdjustment.findMany({
      where: { tenantId, OR: priorPeriodOR, ...(idFilter ? { employeeId: idFilter } : {}) },
      select: { employeeId: true, type: true, amount: true, directionId: true, periodYear: true, periodMonth: true },
    }),
    dbClient.salaryPaymentItem.findMany({
      where: { tenantId, salaryPayment: { OR: priorPeriodOR }, ...(idFilter ? { employeeId: idFilter } : {}) },
      select: {
        employeeId: true, amount: true, directionId: true,
        salaryPayment: { select: { periodYear: true, periodMonth: true } },
      },
    }),
  ])

  // Признак «окладник» считается ПО ПЕРИОДУ строки (версии оклада + okladFrom), а не
  // по текущему значению поля: иначе смена оклада перекидывает окладные деньги
  // прошлых месяцев в сделочный остаток.
  const okladSchedules = await loadOkladSchedules(dbClient, tenantId, employees.map((e) => e.id))
  const empById = new Map(employees.map((e) => [e.id, e]))
  const hasOkladCache = new Map<string, boolean>()
  const hasOkladIn = (empId: string, y: number, m: number): boolean => {
    const key = `${empId}:${y}-${m}`
    const cached = hasOkladCache.get(key)
    if (cached !== undefined) return cached
    const e = empById.get(empId)
    const value = e
      ? okladForPeriod({
          monthlySalary: Number(e.monthlySalary) || 0,
          okladFrom: e.okladFrom,
          schedule: okladSchedules.get(empId) as OkladVersion[] | undefined,
          periodYear: y,
          periodMonth: m,
        }) > 0
      : false
    hasOkladCache.set(key, value)
    return value
  }

  const accruedByEmp = new Map<string, number>()
  const dirPayByEmp = new Map<string, Map<string, number>>()
  for (const a of attendances) {
    const empId = a.lesson.substituteInstructorId || a.lesson.instructorId
    if (!empId) continue
    const amt = Number(a.instructorPayAmount)
    accruedByEmp.set(empId, (accruedByEmp.get(empId) ?? 0) + amt)
    const dirId = a.lesson.group?.directionId ?? null
    if (dirId) {
      let m = dirPayByEmp.get(empId)
      if (!m) {
        m = new Map()
        dirPayByEmp.set(empId, m)
      }
      m.set(dirId, (m.get(dirId) ?? 0) + amt)
    }
  }

  const adjByEmp = new Map<string, { directionId: string | null; type: "bonus" | "penalty"; amount: number; hasOklad: boolean }[]>()
  for (const a of adjustments) {
    const list = adjByEmp.get(a.employeeId) ?? []
    list.push({
      directionId: a.directionId,
      type: a.type as "bonus" | "penalty",
      amount: Number(a.amount),
      hasOklad: hasOkladIn(a.employeeId, a.periodYear, a.periodMonth),
    })
    adjByEmp.set(a.employeeId, list)
  }
  const payByEmp = new Map<string, { directionId: string | null; amount: number; hasOklad: boolean }[]>()
  for (const p of payments) {
    const list = payByEmp.get(p.employeeId) ?? []
    list.push({
      directionId: p.directionId,
      amount: Number(p.amount),
      hasOklad: hasOkladIn(p.employeeId, p.salaryPayment.periodYear, p.salaryPayment.periodMonth),
    })
    payByEmp.set(p.employeeId, list)
  }

  // Первый месяц с зарплатной операцией — нижняя граница окна накопления оклада
  // для тех, у кого дата начала оклада не задана.
  const firstActivityYm = new Map<string, number>()
  for (const a of adjustments) {
    const v = ymNum(a.periodYear, a.periodMonth)
    const prev = firstActivityYm.get(a.employeeId)
    if (prev === undefined || v < prev) firstActivityYm.set(a.employeeId, v)
  }
  for (const p of payments) {
    const v = ymNum(p.salaryPayment.periodYear, p.salaryPayment.periodMonth)
    const prev = firstActivityYm.get(p.employeeId)
    if (prev === undefined || v < prev) firstActivityYm.set(p.employeeId, v)
  }

  // Окладные корректировки/выплаты по периодам — для окладного остатка.
  type PerPeriod = Map<number, number>
  const okladAdjByEmp = new Map<string, PerPeriod>()
  for (const a of adjustments) {
    const ym = ymNum(a.periodYear, a.periodMonth)
    if (kindOfDirection(a.directionId, hasOkladIn(a.employeeId, a.periodYear, a.periodMonth)) !== "salary") continue
    const m = okladAdjByEmp.get(a.employeeId) ?? new Map()
    const delta = a.type === "bonus" ? Number(a.amount) : -Number(a.amount)
    m.set(ym, (m.get(ym) ?? 0) + delta)
    okladAdjByEmp.set(a.employeeId, m)
  }
  const okladPaidByEmp = new Map<string, PerPeriod>()
  for (const p of payments) {
    const py = p.salaryPayment.periodYear
    const pm = p.salaryPayment.periodMonth
    if (kindOfDirection(p.directionId, hasOkladIn(p.employeeId, py, pm)) !== "salary") continue
    const ym = ymNum(py, pm)
    const m = okladPaidByEmp.get(p.employeeId) ?? new Map()
    m.set(ym, (m.get(ym) ?? 0) + Number(p.amount))
    okladPaidByEmp.set(p.employeeId, m)
  }

  const endYm = ymNum(year, month) - 1 // последний прошлый месяц включительно

  const okladBalanceFor = (empId: string): number => {
    const e = empById.get(empId)
    if (!e) return 0
    return computePriorOkladBalanceOne({
      monthlySalary: Number(e.monthlySalary) || 0,
      okladFrom: e.okladFrom,
      schedule: (okladSchedules.get(empId) ?? []) as OkladVersion[],
      firstActivityYm: firstActivityYm.get(empId) ?? null,
      endYm,
      adjByPeriod: okladAdjByEmp.get(empId),
      paidByPeriod: okladPaidByEmp.get(empId),
    })
  }

  const allEmpIds = new Set<string>([
    ...accruedByEmp.keys(),
    ...adjByEmp.keys(),
    ...payByEmp.keys(),
    // Окладник мог за прошлые месяцы вообще не иметь операций — его долг всё равно
    // надо перенести, поэтому добавляем всех с окладом.
    ...employees.filter((e) => Number(e.monthlySalary) > 0 || okladSchedules.has(e.id)).map((e) => e.id),
  ])
  const result = new Map<string, PriorPieceResult>()
  for (const empId of allEmpIds) {
    const balance = computePriorPieceBalanceOne({
      // Фолбэк для строк без периода не используется — каждая строка несёт свой флаг.
      hasOklad: false,
      priorAttendancePay: accruedByEmp.get(empId) ?? 0,
      adjustments: adjByEmp.get(empId) ?? [],
      payments: payByEmp.get(empId) ?? [],
    })
    let topDirectionId: string | null = null
    let topPay = 0
    const dm = dirPayByEmp.get(empId)
    if (dm) for (const [d, p] of dm) if (p > topPay) { topPay = p; topDirectionId = d }
    // Занятий с направлением в прошлом могло не быть (долг из направленной премии
    // или из группы без направления). Тогда берём направление из сделочных
    // корректировок/выплат прошлых периодов — позиция «Доначисление» без
    // направления у окладника классифицировалась бы как оклад, долг бы не погас
    // и всплывал каждый месяц заново.
    if (!topDirectionId) {
      const weights = new Map<string, number>()
      for (const a of adjByEmp.get(empId) ?? []) {
        if (a.directionId) weights.set(a.directionId, (weights.get(a.directionId) ?? 0) + a.amount)
      }
      for (const p of payByEmp.get(empId) ?? []) {
        if (p.directionId) weights.set(p.directionId, (weights.get(p.directionId) ?? 0) + p.amount)
      }
      let best = 0
      for (const [d, w] of weights) if (w > best) { best = w; topDirectionId = d }
    }
    result.set(empId, { balance, topDirectionId, okladBalance: okladBalanceFor(empId) })
  }
  return result
}
