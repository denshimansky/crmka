import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide, pct } from "@/lib/report-helpers"

/** 7.3. P&L на уровне группы */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const groupWhere: any = { tenantId, deletedAt: null, isActive: true }
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
      lesson: { select: { id: true, groupId: true, durationMinutes: true } },
    },
  })

  const groupRevenue = new Map<string, number>()
  const groupSalary = new Map<string, number>()
  const groupLessons = new Map<string, Set<string>>()

  for (const a of attendances) {
    const gId = a.lesson.groupId
    groupRevenue.set(gId, (groupRevenue.get(gId) || 0) + Number(a.chargeAmount))
    if (a.instructorPayEnabled) {
      groupSalary.set(gId, (groupSalary.get(gId) || 0) + Number(a.instructorPayAmount))
    }
    if (!groupLessons.has(gId)) groupLessons.set(gId, new Set())
    groupLessons.get(gId)!.add(a.lesson.id)
  }

  // Branch-level totals for proportional allocation
  const branchRevenue = new Map<string, number>()
  const branchLessons = new Map<string, number>()
  for (const g of groups) {
    const rev = groupRevenue.get(g.id) || 0
    branchRevenue.set(g.branchId, (branchRevenue.get(g.branchId) || 0) + rev)
    const les = groupLessons.get(g.id)?.size || 0
    branchLessons.set(g.branchId, (branchLessons.get(g.branchId) || 0) + les)
  }

  // Expenses per branch
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } },
    select: {
      amount: true,
      isVariable: true,
      branches: { select: { branchId: true } },
    },
  })

  const branchVariableExp = new Map<string, number>()
  const branchFixedExp = new Map<string, number>()
  for (const e of expenses) {
    const amt = Number(e.amount)
    for (const eb of e.branches) {
      if (eb.branchId) {
        if (e.isVariable) {
          branchVariableExp.set(eb.branchId, (branchVariableExp.get(eb.branchId) || 0) + amt)
        } else {
          branchFixedExp.set(eb.branchId, (branchFixedExp.get(eb.branchId) || 0) + amt)
        }
      }
    }
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
