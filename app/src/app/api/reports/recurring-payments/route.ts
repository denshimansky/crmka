import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.4. Календарь постоянных платежей */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  // Recurring expenses for the period
  const expenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isRecurring: true,
    },
    select: {
      id: true,
      amount: true,
      date: true,
      comment: true,
      category: { select: { name: true, isSalary: true } },
    },
  })

  // Expenses paid in current period
  const paidExpenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: dateFrom, lte: dateTo },
      isRecurring: true,
    },
    select: {
      id: true,
      amount: true,
      category: { select: { name: true } },
    },
  })

  // Group by category
  const categories = new Map<string, { plan: number; paid: number; isSalary: boolean }>()
  for (const e of expenses) {
    const key = e.category.name
    const prev = categories.get(key) || { plan: 0, paid: 0, isSalary: e.category.isSalary }
    prev.plan += Number(e.amount)
    categories.set(key, prev)
  }

  for (const e of paidExpenses) {
    const key = e.category.name
    const prev = categories.get(key) || { plan: 0, paid: 0, isSalary: false }
    prev.paid += Number(e.amount)
    categories.set(key, prev)
  }

  const data = [...categories.entries()]
    .map(([category, v]) => ({
      category,
      isSalary: v.isSalary,
      planAmount: v.plan,
      paidAmount: v.paid,
      remainingAmount: Math.max(0, v.plan - v.paid),
    }))
    .sort((a, b) => b.planAmount - a.planAmount)

  return NextResponse.json({
    data,
    metadata: {
      totalPlan: data.reduce((s, d) => s + d.planAmount, 0),
      totalPaid: data.reduce((s, d) => s + d.paidAmount, 0),
      totalRemaining: data.reduce((s, d) => s + d.remainingAmount, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
