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
    dbClient.employee.findMany({
      where: { tenantId, deletedAt: null, ...(idFilter ? { id: idFilter } : {}) },
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

  const allEmpIds = new Set<string>([...accruedByEmp.keys(), ...adjByEmp.keys(), ...payByEmp.keys()])
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
    result.set(empId, { balance, topDirectionId })
  }
  return result
}
