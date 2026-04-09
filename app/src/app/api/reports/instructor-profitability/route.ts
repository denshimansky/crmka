import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide, pct } from "@/lib/report-helpers"

/** 7.5. Сколько денег приносит педагог */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Revenue and salary per instructor from attendances
  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      chargeAmount: true,
      instructorPayAmount: true,
      instructorPayEnabled: true,
      attendanceType: { select: { countsAsRevenue: true } },
      lesson: {
        select: {
          id: true,
          instructorId: true,
          substituteInstructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
          substituteInstructor: { select: { firstName: true, lastName: true } },
          group: { select: { branchId: true } },
        },
      },
    },
  })

  // Aggregate per instructor (substitute gets the salary attribution)
  const instrData = new Map<
    string,
    { name: string; revenue: number; salary: number; lessons: Set<string>; branchId: string }
  >()

  for (const a of attendances) {
    const iId = a.lesson.substituteInstructorId || a.lesson.instructorId
    const instr = a.lesson.substituteInstructorId && a.lesson.substituteInstructor
      ? a.lesson.substituteInstructor
      : a.lesson.instructor
    if (!instrData.has(iId)) {
      instrData.set(iId, {
        name: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
        revenue: 0,
        salary: 0,
        lessons: new Set(),
        branchId: a.lesson.group.branchId,
      })
    }
    const d = instrData.get(iId)!
    if (a.attendanceType.countsAsRevenue) d.revenue += Number(a.chargeAmount)
    if (a.instructorPayEnabled) d.salary += Number(a.instructorPayAmount)
    d.lessons.add(a.lesson.id)
  }

  // Branch total lessons for variable expense allocation
  const branchTotalLessons = new Map<string, number>()
  for (const [, d] of instrData) {
    branchTotalLessons.set(d.branchId, (branchTotalLessons.get(d.branchId) || 0) + d.lessons.size)
  }

  // Branch total revenue for fixed expense allocation
  const branchTotalRevenue = new Map<string, number>()
  for (const [, d] of instrData) {
    branchTotalRevenue.set(d.branchId, (branchTotalRevenue.get(d.branchId) || 0) + d.revenue)
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

  const branchVarExp = new Map<string, number>()
  const branchFixExp = new Map<string, number>()
  for (const e of expenses) {
    for (const eb of e.branches) {
      if (eb.branchId) {
        if (e.isVariable) branchVarExp.set(eb.branchId, (branchVarExp.get(eb.branchId) || 0) + Number(e.amount))
        else branchFixExp.set(eb.branchId, (branchFixExp.get(eb.branchId) || 0) + Number(e.amount))
      }
    }
  }

  const totalNetProfit = [...instrData.values()].reduce((s, d) => {
    const bLes = branchTotalLessons.get(d.branchId) || 1
    const bRev = branchTotalRevenue.get(d.branchId) || 1
    const varShare = (branchVarExp.get(d.branchId) || 0) * (d.lessons.size / bLes)
    const fixShare = (branchFixExp.get(d.branchId) || 0) * (d.revenue / bRev)
    return s + (d.revenue - d.salary - varShare - fixShare)
  }, 0)

  const data = [...instrData.entries()]
    .map(([id, d]) => {
      const bLes = branchTotalLessons.get(d.branchId) || 1
      const bRev = branchTotalRevenue.get(d.branchId) || 1
      const varShare = (branchVarExp.get(d.branchId) || 0) * safeDivide(d.lessons.size, bLes)
      const fixShare = (branchFixExp.get(d.branchId) || 0) * safeDivide(d.revenue, bRev)
      const profitability = d.revenue - d.salary - varShare - fixShare

      return {
        instructorId: id,
        instructorName: d.name,
        revenue: Math.round(d.revenue),
        salary: Math.round(d.salary),
        variableExpenses: Math.round(varShare),
        fixedExpenses: Math.round(fixShare),
        profitability: Math.round(profitability),
        percentOfTotal: pct(profitability, totalNetProfit),
      }
    })
    .sort((a, b) => b.profitability - a.profitability)

  return NextResponse.json({
    data,
    metadata: {
      totalNetProfit: Math.round(totalNetProfit),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
