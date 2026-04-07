import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 7.4. % распределения финансового результата */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Revenue
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

  // Salary
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
    },
    select: { instructorPayAmount: true },
  })
  const totalSalary = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // Expenses by category
  const expWhere: any = { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    select: { amount: true, category: { select: { name: true } } },
  })

  const byCategory: Record<string, number> = {}
  for (const e of expenses) {
    byCategory[e.category.name] = (byCategory[e.category.name] || 0) + Number(e.amount)
  }

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfit = revenue - totalExpenses - totalSalary

  const data = [
    { category: "ЗП инструкторов", amount: totalSalary, percentOfRevenue: pct(totalSalary, revenue) },
    ...Object.entries(byCategory)
      .map(([category, amount]) => ({
        category,
        amount,
        percentOfRevenue: pct(amount, revenue),
      }))
      .sort((a, b) => b.amount - a.amount),
  ]

  return NextResponse.json({
    data,
    metadata: {
      revenue,
      totalExpenses: totalExpenses + totalSalary,
      netProfit,
      profitPercent: pct(netProfit, revenue),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
