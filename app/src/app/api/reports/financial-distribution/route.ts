import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import {
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"

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

  // Expenses by category — учитываем период признания (recognitionMode + amortization*).
  const expensesFrom = new Date(dateFrom)
  expensesFrom.setUTCMonth(expensesFrom.getUTCMonth() - AMORTIZATION_LOOKBACK_MONTHS)
  const expWhere: any = { tenantId, deletedAt: null, date: { gte: expensesFrom, lte: dateTo } }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    select: {
      amount: true,
      date: true,
      recognitionMode: true,
      amortizationMonths: true,
      amortizationStartDate: true,
      category: { select: { name: true } },
    },
  })

  const fromY = dateFrom.getUTCFullYear()
  const fromM = dateFrom.getUTCMonth() + 1
  const toY = dateTo.getUTCFullYear()
  const toM = dateTo.getUTCMonth() + 1

  const byCategory: Record<string, number> = {}
  let totalExpenses = 0
  for (const e of expenses) {
    const amt = expenseAmountInWindow(e, fromY, fromM, toY, toM)
    if (amt === 0) continue
    byCategory[e.category.name] = (byCategory[e.category.name] || 0) + amt
    totalExpenses += amt
  }
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
