import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import { distributeFixedExpenses, type FixedExpenseItem } from "@/lib/expense-distribution"

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
    select: {
      chargeAmount: true,
      lesson: {
        select: {
          group: {
            select: {
              directionId: true,
              direction: { select: { name: true } },
              branchId: true,
              branch: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  const revenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Revenue by direction (for fixed expense distribution)
  const revenueByDirection: Record<string, { name: string; revenue: number }> = {}
  for (const a of attendances) {
    const dirId = a.lesson.group.directionId
    const dirName = a.lesson.group.direction.name
    if (!revenueByDirection[dirId]) {
      revenueByDirection[dirId] = { name: dirName, revenue: 0 }
    }
    revenueByDirection[dirId].revenue += Number(a.chargeAmount)
  }

  // Expenses
  const expWhere: any = { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    include: { category: { select: { id: true, name: true, isSalary: true, isVariable: true } } },
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

  // FIN-16: Distribute fixed expenses by direction revenue
  const fixedExpenseItems: FixedExpenseItem[] = expenses
    .filter((e) => !e.category.isVariable)
    .reduce<FixedExpenseItem[]>((acc, e) => {
      const existing = acc.find((x) => x.id === e.category.id)
      if (existing) {
        existing.amount += Number(e.amount)
      } else {
        acc.push({ id: e.category.id, category: e.category.name, amount: Number(e.amount) })
      }
      return acc
    }, [])

  const revenueMap: Record<string, number> = {}
  for (const [dirId, info] of Object.entries(revenueByDirection)) {
    revenueMap[dirId] = info.revenue
  }

  const distribution = distributeFixedExpenses(fixedExpenseItems, revenueMap)

  // Build distribution summary for response
  const distributionByDirection = Object.entries(distribution.byKey).map(([dirId, items]) => ({
    directionId: dirId,
    directionName: revenueByDirection[dirId]?.name ?? dirId,
    revenue: revenueByDirection[dirId]?.revenue ?? 0,
    revenueShare: revenue > 0 ? Math.round(((revenueByDirection[dirId]?.revenue ?? 0) / revenue) * 1000) / 10 : 0,
    distributedFixedExpenses: distribution.totalByKey[dirId],
    items: items.map((item) => ({
      category: item.category,
      originalAmount: item.originalAmount,
      distributedAmount: item.distributedAmount,
      share: item.share,
    })),
  }))

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
      // FIN-16: distribution breakdown
      fixedExpenseDistribution: {
        totalFixed: distribution.totalFixed,
        byDirection: distributionByDirection,
      },
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
