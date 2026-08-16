// Раскладка ФАКТИЧЕСКОЙ выплаты ЗП (SalaryPayment) по филиалам — «как в финрезе».
//
// Зачем: страница «Расходы» (ДДС по факту) показывает выплаты ЗП сырьём, у самого
// SalaryPayment нет филиала (только сотрудник + счёт). А ОПИУ относит ЗП к филиалам
// двумя механизмами:
//   • ОКЛАД  — оклад-твин (Expense «Зарплата окладников») с ExpenseBranch-связями из
//     Employee.okladBranchIds, разносится ∝ выручке (см. sync-oklad-twin + pnl-allocation);
//   • СДЕЛКА — Attendance.instructorPayAmount по РЕАЛЬНОМУ филиалу занятия
//     (lesson.group.branchId), без пропорции (см. recognized-piece / pnl-by-direction).
//
// Здесь для каждой пары (сотрудник, период) собираем вектор весов по филиалам из тех же
// источников (оклад-твин ⊕ сделочные начисления периода) и дробим сумму каждой выплаты
// этого периода ∝ вектору. Так одна выплата совмещающего сотрудника корректно
// «размазывается» между филиалом оклада и филиалами занятий — ровно как в ОПИУ.
//
// ВАЖНО про суммы: ДДС показывает ФАКТ выплаты (вкл. авансы/переплату), а ОПИУ —
// признанную часть. Поэтому по филиалам совпадают ПРОПОРЦИИ (куда отнесён труд), но не
// абсолютные суммы: аванс сверх признанного просто следует той же пропорции. Если у
// (сотрудника, периода) нет ни оклад-твина, ни сделочных начислений — выплата остаётся
// «без филиала» (branchId=null).

import { db } from "@/lib/db"
import {
  distribute,
  resolveTargets,
  buildCellRevenue,
  NO_BRANCH_ID,
  NO_DIRECTION_ID,
  type CellRevenue,
  type Target,
} from "@/lib/pnl-allocation"
import { OKLAD_EXPENSE_CATEGORY_NAME } from "./oklad-category"

/** Доля выплаты, приходящаяся на филиал (branchId=null — «без филиала»/общий). */
export interface SalaryBranchPart {
  branchId: string | null
  amount: number
}

/** Вход: минимум полей выплаты, нужный для раскладки. */
export interface SalaryPaymentForAlloc {
  id: string
  employeeId: string
  amount: number
  periodYear: number
  periodMonth: number
}

function ymKeyOf(year: number, month1to12: number): number {
  return year * 12 + (month1to12 - 1)
}
function ymKeyOfDate(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}
function addWeight(m: Map<string, number>, branchId: string, delta: number) {
  if (delta === 0) return
  m.set(branchId, (m.get(branchId) ?? 0) + delta)
}

/**
 * Возвращает Map<paymentId, SalaryBranchPart[]>. Каждый список в сумме равен amount выплаты
 * (distribute компенсирует округление в последней доле). Ключ порядка детерминирован.
 */
export async function allocateSalaryPaymentsByBranch(
  tenantId: string,
  payments: SalaryPaymentForAlloc[],
): Promise<Map<string, SalaryBranchPart[]>> {
  const result = new Map<string, SalaryBranchPart[]>()
  if (payments.length === 0) return result

  const empIds = Array.from(new Set(payments.map((p) => p.employeeId)))
  // Пары (сотрудник, период) и множество месяцев-периодов.
  const periodKeys = Array.from(new Set(payments.map((p) => ymKeyOf(p.periodYear, p.periodMonth))))
  const periodYears = Array.from(new Set(payments.map((p) => p.periodYear)))
  const periodMonths = Array.from(new Set(payments.map((p) => p.periodMonth)))
  const minYm = Math.min(...periodKeys)
  const maxYm = Math.max(...periodKeys)
  const rangeStart = new Date(Date.UTC(Math.floor(minYm / 12), minYm % 12, 1))
  const rangeEnd = new Date(Date.UTC(Math.floor(maxYm / 12), (maxYm % 12) + 1, 0))

  // 1) Оклад-твины интересующих (сотрудник, период). Фильтр по годам/месяцам «широкий»
  //    (IN год × IN месяц), точную пару (год,месяц) сверяем в JS.
  const periodPairSet = new Set(periodKeys)
  const twins = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      category: { name: OKLAD_EXPENSE_CATEGORY_NAME },
      salaryPayment: {
        employeeId: { in: empIds },
        periodYear: { in: periodYears },
        periodMonth: { in: periodMonths },
      },
    },
    select: {
      amount: true,
      salaryPayment: { select: { employeeId: true, periodYear: true, periodMonth: true } },
      branches: { select: { branchId: true, directionId: true } },
    },
  })

  // 2) Сделочные начисления сотрудников за диапазон периодов — по РЕАЛЬНОМУ филиалу занятия.
  const atts = await db.attendance.findMany({
    where: {
      tenantId,
      instructorPayEnabled: true,
      lesson: {
        date: { gte: rangeStart, lte: rangeEnd },
        OR: [{ instructorId: { in: empIds } }, { substituteInstructorId: { in: empIds } }],
      },
    },
    select: {
      instructorPayAmount: true,
      lesson: {
        select: {
          date: true,
          instructorId: true,
          substituteInstructorId: true,
          group: { select: { branchId: true } },
        },
      },
    },
  })

  // 3) Выручка ячеек (филиал, направление) по каждому месяцу-периоду — для аллокации оклада.
  const revByRow = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: rangeStart, lte: rangeEnd } },
      attendanceType: { countsAsRevenue: true },
    },
    select: {
      chargeAmount: true,
      lesson: { select: { date: true, group: { select: { branchId: true, directionId: true } } } },
    },
  })
  const cellRevByYm = new Map<number, CellRevenue>()
  {
    const rowsByYm = new Map<number, { branchId: string; directionId: string; amount: number }[]>()
    for (const a of revByRow) {
      const ym = ymKeyOfDate(a.lesson.date)
      if (!periodPairSet.has(ym)) continue
      let arr = rowsByYm.get(ym)
      if (!arr) rowsByYm.set(ym, (arr = []))
      arr.push({
        branchId: a.lesson.group.branchId,
        directionId: a.lesson.group.directionId,
        amount: Number(a.chargeAmount),
      })
    }
    for (const [ym, rows] of rowsByYm) cellRevByYm.set(ym, buildCellRevenue(rows))
  }
  const emptyCellRev: CellRevenue = new Map()

  // --- Веса по (empId, ymKey) ---
  const key = (empId: string, ym: number) => `${empId}::${ym}`

  // Оклад: раскладываем сумму каждого твина по его связям ∝ выручке периода.
  const okladW = new Map<string, Map<string, number>>()
  for (const t of twins) {
    const sp = t.salaryPayment
    if (!sp) continue
    const ym = ymKeyOf(sp.periodYear, sp.periodMonth)
    if (!periodPairSet.has(ym)) continue
    const cellRev = cellRevByYm.get(ym) ?? emptyCellRev
    const links = t.branches.map((b) => ({ branchId: b.branchId, directionId: b.directionId }))
    const k = key(sp.employeeId, ym)
    let w = okladW.get(k)
    if (!w) okladW.set(k, (w = new Map()))
    const wRef = w
    distribute(Number(t.amount), resolveTargets(links, cellRev), (b, _d, part) => addWeight(wRef, b, part))
  }

  // Сделка: суммируем начисления по (payee, ymKey, филиал занятия).
  const pieceW = new Map<string, Map<string, number>>()
  const empIdSet = new Set(empIds)
  for (const a of atts) {
    const l = a.lesson
    const payee = l.substituteInstructorId ?? l.instructorId
    if (!payee || !empIdSet.has(payee)) continue
    const ym = ymKeyOfDate(l.date)
    if (!periodPairSet.has(ym)) continue
    const k = key(payee, ym)
    let w = pieceW.get(k)
    if (!w) pieceW.set(k, (w = new Map()))
    addWeight(w, l.group.branchId, Number(a.instructorPayAmount))
  }

  // --- Итоговый вектор весов и дробление выплат ---
  // Кэшируем цели по (empId, ymKey), т.к. в периоде может быть несколько выплат.
  const targetsByKey = new Map<string, Target[]>()
  const buildTargets = (empId: string, ym: number): Target[] => {
    const k = key(empId, ym)
    const cached = targetsByKey.get(k)
    if (cached) return cached
    const total = new Map<string, number>()
    for (const [b, v] of okladW.get(k) ?? []) addWeight(total, b, v)
    for (const [b, v] of pieceW.get(k) ?? []) addWeight(total, b, v)
    const targets: Target[] = Array.from(total, ([b, weight]) => ({ b, d: NO_DIRECTION_ID, weight }))
      // Детерминированный порядок долей.
      .sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : 0))
    targetsByKey.set(k, targets)
    return targets
  }

  for (const p of payments) {
    const ym = ymKeyOf(p.periodYear, p.periodMonth)
    const targets = buildTargets(p.employeeId, ym)
    const parts: SalaryBranchPart[] = []
    if (targets.length === 0) {
      parts.push({ branchId: null, amount: p.amount })
    } else {
      distribute(p.amount, targets, (b, _d, part) => {
        parts.push({ branchId: b === NO_BRANCH_ID ? null : b, amount: part })
      })
    }
    result.set(p.id, parts)
  }
  return result
}
