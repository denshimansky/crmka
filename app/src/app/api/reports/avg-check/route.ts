import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide } from "@/lib/report-helpers"

export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const where: any = {
    tenantId,
    deletedAt: null,
    type: "incoming",
    date: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) {
    where.client = { branchId }
  }

  const payments = await db.payment.findMany({
    where,
    select: { amount: true, method: true },
  })

  const totalAmount = payments.reduce((s, p) => s + Number(p.amount), 0)
  const totalCount = payments.length
  const avgCheck = safeDivide(totalAmount, totalCount)

  // Group by payment method
  const byMethod: Record<string, { amount: number; count: number }> = {}
  for (const p of payments) {
    if (!byMethod[p.method]) byMethod[p.method] = { amount: 0, count: 0 }
    byMethod[p.method].amount += Number(p.amount)
    byMethod[p.method].count += 1
  }

  const methodRows = Object.entries(byMethod)
    .map(([method, data]) => ({
      method,
      amount: data.amount,
      count: data.count,
      avg: safeDivide(data.amount, data.count),
    }))
    .sort((a, b) => b.amount - a.amount)

  return NextResponse.json({
    data: methodRows,
    metadata: {
      totalAmount,
      totalCount,
      avgCheck,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
