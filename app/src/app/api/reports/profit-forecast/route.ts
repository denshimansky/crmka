import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 7.1. Прогноз прибыли */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Subscription amounts (expected revenue)
  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
    status: { in: ["active", "pending"] },
  }
  if (branchId) subWhere.group = { branchId }

  const subAgg = await db.subscription.aggregate({
    where: subWhere,
    _sum: { finalAmount: true },
  })
  const totalSubscriptionAmount = Number(subAgg._sum.finalAmount || 0)

  // Salary forecast from salary rates + attendances
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
    },
    select: { instructorPayAmount: true },
  })
  const salaryForecast = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // Variable expenses (avg from last 3 months)
  const threeMonthsAgo = new Date(Date.UTC(year, month - 4, 1))
  const prevExpenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isVariable: true,
      date: { gte: threeMonthsAgo, lt: dateFrom },
    },
    select: { amount: true, date: true },
  })

  // Average per month
  const monthBuckets = new Map<string, number>()
  for (const e of prevExpenses) {
    const key = `${e.date.getUTCFullYear()}-${e.date.getUTCMonth()}`
    monthBuckets.set(key, (monthBuckets.get(key) || 0) + Number(e.amount))
  }
  const avgVariable =
    monthBuckets.size > 0
      ? [...monthBuckets.values()].reduce((s, v) => s + v, 0) / monthBuckets.size
      : 0

  // Recurring (fixed) expenses
  const recurringExpenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, isRecurring: true },
    select: { amount: true },
  })
  const fixedExpensesForecast = recurringExpenses.reduce((s, e) => s + Number(e.amount), 0)

  const profitForecast =
    totalSubscriptionAmount - salaryForecast - avgVariable - fixedExpensesForecast

  return NextResponse.json({
    data: {
      subscriptionAmount: totalSubscriptionAmount,
      salaryForecast,
      variableExpensesForecast: Math.round(avgVariable),
      fixedExpensesForecast,
      profitForecast: Math.round(profitForecast),
    },
    metadata: {
      year,
      month,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
