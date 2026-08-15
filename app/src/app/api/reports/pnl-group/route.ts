import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide, pct } from "@/lib/report-helpers"
import {
  expenseAmountInWindow,
  expenseFetchWindow,
} from "@/lib/expense-amortization"
import { buildCellRevenue, resolveTargets, distribute, NO_BRANCH_ID } from "@/lib/pnl-allocation"
import { loadPieceRatioMap, makeRatioLookup, ymKeyOf } from "@/lib/salary/recognized-piece"

/** 7.3. P&L на уровне группы */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // P&L строится по группам — технические одноразовые группы исключаем,
  // их выручка/расходы попадут в общий итог по филиалу через автораспределение.
  const groupWhere: any = { tenantId, deletedAt: null, isActive: true, isOneTime: false }
  if (branchId) groupWhere.branchId = branchId

  const groups = await db.group.findMany({
    where: groupWhere,
    select: {
      id: true,
      name: true,
      branchId: true,
      direction: { select: { name: true } },
      branch: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
    },
  })

  // Revenue per group (from attendances)
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      attendanceType: { countsAsRevenue: true },
    },
    select: {
      chargeAmount: true,
      instructorPayAmount: true,
      instructorPayEnabled: true,
      lesson: { select: { id: true, date: true, groupId: true, durationMinutes: true, instructorId: true, substituteInstructorId: true, group: { select: { branchId: true, directionId: true } } } },
    },
  })

  // Сделка в ОПИУ — «по выплате, в месяц работы» (FIFO). См. lib/salary/recognized-piece.
  const pieceRatio = makeRatioLookup(
    await loadPieceRatioMap(
      tenantId,
      ymKeyOf(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth() + 1),
      ymKeyOf(dateTo.getUTCFullYear(), dateTo.getUTCMonth() + 1),
    ),
  )

  const groupRevenue = new Map<string, number>()
  const groupSalary = new Map<string, number>()
  const groupLessons = new Map<string, Set<string>>()

  for (const a of attendances) {
    const gId = a.lesson.groupId
    groupRevenue.set(gId, (groupRevenue.get(gId) || 0) + Number(a.chargeAmount))
    if (a.instructorPayEnabled) {
      groupSalary.set(
        gId,
        (groupSalary.get(gId) || 0) +
          Number(a.instructorPayAmount) *
            pieceRatio(a.lesson.substituteInstructorId ?? a.lesson.instructorId, a.lesson.date),
      )
    }
    if (!groupLessons.has(gId)) groupLessons.set(gId, new Set())
    groupLessons.get(gId)!.add(a.lesson.id)
  }

  // Веса аллокации расходов по ячейкам (филиал, направление) — по всей сети.
  const cellRevenue = buildCellRevenue(
    attendances.map((a) => ({ branchId: a.lesson.group.branchId, directionId: a.lesson.group.directionId, amount: Number(a.chargeAmount) })),
  )

  // Branch-level totals for proportional allocation
  const branchRevenue = new Map<string, number>()
  const branchLessons = new Map<string, number>()
  for (const g of groups) {
    const rev = groupRevenue.get(g.id) || 0
    branchRevenue.set(g.branchId, (branchRevenue.get(g.branchId) || 0) + rev)
    const les = groupLessons.get(g.id)?.size || 0
    branchLessons.set(g.branchId, (branchLessons.get(g.branchId) || 0) + les)
  }

  // Expenses per branch — окно выборки расширяем в ОБЕ стороны: расход мог быть оплачен
  // раньше месяца признания (аренда вперёд) ИЛИ позже (начисление раньше оплаты, напр. взносы
  // за июль оплачены в августе). expenseAmountInWindow отбирает точные доли внутри окна.
  const { gte: expensesFrom, lte: expensesTo } = expenseFetchWindow(
    dateFrom.getUTCFullYear(), dateFrom.getUTCMonth() + 1,
    dateTo.getUTCFullYear(), dateTo.getUTCMonth() + 1,
  )
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: expensesFrom, lte: expensesTo } },
    select: {
      amount: true,
      date: true,
      recognitionMode: true,
      amortizationMonths: true,
      amortizationStartDate: true,
      isVariable: true,
      branches: { select: { branchId: true, directionId: true } },
    },
  })

  const fromY = dateFrom.getUTCFullYear()
  const fromM = dateFrom.getUTCMonth() + 1
  const toY = dateTo.getUTCFullYear()
  const toM = dateTo.getUTCMonth() + 1

  // Расход раскладывается по филиалам ∝ выручке (единое ядро): общий (без филиала) и
  // оклад-твин (branchId=null) распределяются по всей сети — раньше молча выпадали;
  // мультифилиальный делится между филиалами, а не задваивается в каждом.
  const branchVariableExp = new Map<string, number>()
  const branchFixedExp = new Map<string, number>()
  for (const e of expenses) {
    const amt = expenseAmountInWindow(e, fromY, fromM, toY, toM)
    if (amt === 0) continue
    const target = e.isVariable ? branchVariableExp : branchFixedExp
    distribute(
      amt,
      resolveTargets(e.branches.map((b) => ({ branchId: b.branchId, directionId: b.directionId })), cellRevenue),
      (b, _d, part) => {
        if (b === NO_BRANCH_ID) return // нет выручки в сети → некуда отнести
        target.set(b, (target.get(b) || 0) + part)
      },
    )
  }

  const data = groups.map((g) => {
    const rev = groupRevenue.get(g.id) || 0
    const sal = groupSalary.get(g.id) || 0
    const les = groupLessons.get(g.id)?.size || 0

    const bRev = branchRevenue.get(g.branchId) || 0
    const bLes = branchLessons.get(g.branchId) || 0

    // Variable expenses proportional to lessons
    const bVarExp = branchVariableExp.get(g.branchId) || 0
    const varExpShare = bLes > 0 ? bVarExp * (les / bLes) : 0

    // Fixed expenses proportional to revenue
    const bFixExp = branchFixedExp.get(g.branchId) || 0
    const fixExpShare = bRev > 0 ? bFixExp * (rev / bRev) : bFixExp / Math.max(groups.filter((gg) => gg.branchId === g.branchId).length, 1)

    const profit = rev - sal - varExpShare - fixExpShare

    // Active students
    const activeStudents = new Set(
      attendances
        .filter((a) => a.lesson.groupId === g.id)
        .map((a) => a.lesson.id)
    ).size

    return {
      groupId: g.id,
      groupName: g.name,
      direction: g.direction.name,
      branch: g.branch.name,
      instructor: [g.instructor.lastName, g.instructor.firstName].filter(Boolean).join(" "),
      revenue: Math.round(rev),
      instructorSalary: Math.round(sal),
      variableExpenses: Math.round(varExpShare),
      fixedExpenses: Math.round(fixExpShare),
      profit: Math.round(profit),
      profitability: pct(profit, rev),
      lessons: les,
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => b.profit - a.profit),
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
