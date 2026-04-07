import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 5.3. Ожидаемые поступления */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
    status: { in: ["active", "pending"] },
  }
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      finalAmount: true,
      discountAmount: true,
      balance: true,
      direction: { select: { name: true } },
      client: { select: { clientStatus: true } },
    },
  })

  // Only active clients' unpaid subscriptions
  const activeSubs = subs.filter((s) => s.client.clientStatus === "active")

  const totalSubAmount = activeSubs.reduce((s, sub) => s + Number(sub.finalAmount), 0)
  const totalBalance = activeSubs.reduce((s, sub) => s + Number(sub.balance), 0)
  // Expected = sum of positive balances (owed)
  const expected = activeSubs
    .filter((s) => Number(s.balance) > 0)
    .reduce((s, sub) => s + Number(sub.balance), 0)
  const totalPaid = totalSubAmount - expected
  const totalDiscount = activeSubs.reduce((s, sub) => s + Number(sub.discountAmount), 0)

  // By direction
  const byDirection: Record<string, { subAmount: number; expected: number; paid: number }> = {}
  for (const s of activeSubs) {
    const dir = s.direction.name
    if (!byDirection[dir]) byDirection[dir] = { subAmount: 0, expected: 0, paid: 0 }
    byDirection[dir].subAmount += Number(s.finalAmount)
    const bal = Number(s.balance)
    if (bal > 0) byDirection[dir].expected += bal
    else byDirection[dir].paid += Number(s.finalAmount)
  }

  // Forecast next month — active subscriptions' finalAmount
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year

  const nextMonthForecast = await db.subscription.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: nextYear,
      periodMonth: nextMonth,
      status: { in: ["active", "pending"] },
      client: { clientStatus: "active" },
    },
    _sum: { finalAmount: true },
    _count: true,
  })

  return NextResponse.json({
    data: Object.entries(byDirection)
      .map(([direction, v]) => ({
        direction,
        ...v,
        debtPercent: pct(v.expected, v.subAmount),
      }))
      .sort((a, b) => b.expected - a.expected),
    metadata: {
      totalSubAmount,
      expectedIncome: expected,
      totalPaid,
      debtPercent: pct(expected, totalSubAmount),
      totalDiscount,
      nextMonthForecast: Number(nextMonthForecast._sum.finalAmount || 0),
      nextMonthSubCount: nextMonthForecast._count,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
