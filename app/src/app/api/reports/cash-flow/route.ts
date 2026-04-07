import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.5. Движения денежных средств (ДДС) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Income (payments from clients)
  const paymentWhere: any = {
    tenantId,
    deletedAt: null,
    type: "incoming",
    date: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) paymentWhere.client = { branchId }

  const payments = await db.payment.findMany({
    where: paymentWhere,
    select: { amount: true, method: true, date: true },
  })

  const totalIncome = payments.reduce((s, p) => s + Number(p.amount), 0)

  // Expenses
  const expenseWhere: any = {
    tenantId,
    deletedAt: null,
    date: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) expenseWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expenseWhere,
    select: {
      amount: true,
      date: true,
      category: { select: { name: true, isVariable: true } },
    },
  })

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  // Salary payments
  const salaryPayments = await db.salaryPayment.findMany({
    where: {
      tenantId,
      date: { gte: dateFrom, lte: dateTo },
    },
    select: { amount: true },
  })
  const totalSalaryPaid = salaryPayments.reduce((s, p) => s + Number(p.amount), 0)

  // Group income by method
  const incomeByMethod: Record<string, number> = {}
  for (const p of payments) {
    incomeByMethod[p.method] = (incomeByMethod[p.method] || 0) + Number(p.amount)
  }

  // Group expenses by category
  const expenseByCategory: Record<string, number> = {}
  for (const e of expenses) {
    expenseByCategory[e.category.name] = (expenseByCategory[e.category.name] || 0) + Number(e.amount)
  }

  // Daily breakdown
  const dailyData: Record<string, { income: number; expense: number }> = {}
  for (const p of payments) {
    const day = p.date.toISOString().split("T")[0]
    if (!dailyData[day]) dailyData[day] = { income: 0, expense: 0 }
    dailyData[day].income += Number(p.amount)
  }
  for (const e of expenses) {
    const day = e.date.toISOString().split("T")[0]
    if (!dailyData[day]) dailyData[day] = { income: 0, expense: 0 }
    dailyData[day].expense += Number(e.amount)
  }

  return NextResponse.json({
    data: {
      incomeByMethod,
      expenseByCategory,
      daily: Object.entries(dailyData)
        .map(([date, v]) => ({ date, ...v, net: v.income - v.expense }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    metadata: {
      totalIncome,
      totalExpenses,
      totalSalaryPaid,
      totalOutflow: totalExpenses + totalSalaryPaid,
      netCashFlow: totalIncome - totalExpenses - totalSalaryPaid,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
