import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.7. Поступления денег по дням */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const accountId = searchParams.get("accountId")
  const clientOnly = searchParams.get("clientOnly") !== "false" // default true

  const where: any = {
    tenantId,
    deletedAt: null,
    type: "incoming",
    date: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) where.client = { branchId }
  if (accountId) where.accountId = accountId

  const payments = await db.payment.findMany({
    where,
    select: {
      amount: true,
      method: true,
      date: true,
      account: { select: { name: true } },
    },
  })

  // Group by day
  const byDay: Record<string, { cash: number; noncash: number; total: number; byAccount: Record<string, number> }> = {}
  const cashMethods = ["cash"]

  for (const p of payments) {
    const day = p.date.toISOString().split("T")[0]
    if (!byDay[day]) byDay[day] = { cash: 0, noncash: 0, total: 0, byAccount: {} }
    const amt = Number(p.amount)
    byDay[day].total += amt
    if (cashMethods.includes(p.method)) {
      byDay[day].cash += amt
    } else {
      byDay[day].noncash += amt
    }
    const accName = p.account.name
    byDay[day].byAccount[accName] = (byDay[day].byAccount[accName] || 0) + amt
  }

  const data = Object.entries(byDay)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    data,
    metadata: {
      totalAmount: payments.reduce((s, p) => s + Number(p.amount), 0),
      totalPayments: payments.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
