import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"
import { computeMonthSubscriptionFigures } from "@/lib/finance/subscription-month-figures"
import { sumPaidTrialRevenue } from "@/lib/finance/paid-trial-revenue"

/** 7.1. Прогноз прибыли */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams, scope } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // «Сумма абонементов» = единый набор месяца (спека Ани 09.08.2026, см.
  // lib/finance/subscription-month-figures.ts): ВСЕ статусы и клиенты, включая
  // воронку; закрытые/выбывшие — по факту отработанного. Та же сумма, что в
  // карточках дашборда «Ожидаемые/Отработанные/Прогноз» и отчёте «Ожидаемые
  // поступления».
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const figures = await computeMonthSubscriptionFigures(db, {
    tenantId,
    year,
    month,
    scope,
    branchId,
    isPackageOrg: org?.subscriptionType === "package",
  })
  const totalSubscriptionAmount = figures.reduce((s, f) => s + f.subAmount, 0)

  // Спека B1: платные пробные — выручка (в ОПИУ входят), но абонементный источник
  // их не видит. Досчитываем реализованную выручку пробных за месяц.
  const paidTrialRevenue = await sumPaidTrialRevenue(db, { tenantId, year, month, scope, branchId })
  const revenueBase = totalSubscriptionAmount + paidTrialRevenue

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
      // «Не учитывать в финрезе» — не участвует в прогнозе прибыли.
      recognitionMode: { not: "not_in_pnl" },
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
    where: { tenantId, deletedAt: null, isRecurring: true, recognitionMode: { not: "not_in_pnl" } },
    select: { amount: true },
  })
  const fixedExpensesForecast = recurringExpenses.reduce((s, e) => s + Number(e.amount), 0)

  const profitForecast =
    revenueBase - salaryForecast - avgVariable - fixedExpensesForecast

  return NextResponse.json({
    data: {
      subscriptionAmount: revenueBase,
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
