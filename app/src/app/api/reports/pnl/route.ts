import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 7.2. Финансовый результат (P&L) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const showPercent = searchParams.get("showPercent") === "true" // 7.4 toggle

  // Revenue = charged amounts from attendances (countsAsRevenue)
  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
    attendanceType: { countsAsRevenue: true },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: { chargeAmount: true },
  })
  const revenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Expenses
  const expWhere: any = { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    include: { category: { select: { name: true, isSalary: true, isVariable: true } } },
  })

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  // Salary accrued
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
      ...(branchId ? { lesson: { date: { gte: dateFrom, lte: dateTo }, group: { branchId } } } : {}),
    },
    select: { instructorPayAmount: true },
  })
  const totalSalaryAccrued = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // By category
  const byCategory: Record<string, { amount: number; isSalary: boolean; isVariable: boolean }> = {}
  for (const e of expenses) {
    const key = e.category.name
    if (!byCategory[key]) byCategory[key] = { amount: 0, isSalary: e.category.isSalary, isVariable: e.category.isVariable }
    byCategory[key].amount += Number(e.amount)
  }

  const variableExpenses = expenses.filter((e) => e.category.isVariable).reduce((s, e) => s + Number(e.amount), 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const totalVariableCosts = variableExpenses + totalSalaryAccrued
  const margin = revenue - totalVariableCosts
  const netProfit = revenue - totalExpenses - totalSalaryAccrued
  const profitability = revenue > 0 ? (netProfit / revenue) * 100 : 0

  const expenseRows = Object.entries(byCategory)
    .map(([category, v]) => ({
      category,
      amount: v.amount,
      isSalary: v.isSalary,
      isVariable: v.isVariable,
      percentOfRevenue: showPercent ? pct(v.amount, revenue) : undefined,
    }))
    .sort((a, b) => b.amount - a.amount)

  return NextResponse.json({
    data: {
      revenue,
      salaryAccrued: totalSalaryAccrued,
      variableExpenses,
      fixedExpenses,
      totalVariableCosts,
      margin,
      netProfit,
      profitability: Math.round(profitability * 10) / 10,
      expensesByCategory: expenseRows,
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
