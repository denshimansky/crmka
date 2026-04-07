import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.10. Отработанные абонементы */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      finalAmount: true,
      chargedAmount: true,
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  const data = subs.map((s) => ({
    clientId: s.client.id,
    clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
    direction: s.direction.name,
    group: s.group.name,
    subscriptionAmount: Number(s.finalAmount),
    workedAmount: Number(s.chargedAmount),
    remainingAmount: Number(s.finalAmount) - Number(s.chargedAmount),
  }))

  const totalSubAmount = data.reduce((s, d) => s + d.subscriptionAmount, 0)
  const totalWorked = data.reduce((s, d) => s + d.workedAmount, 0)

  return NextResponse.json({
    data: data.sort((a, b) => b.workedAmount - a.workedAmount),
    metadata: {
      totalSubscriptions: subs.length,
      totalSubscriptionAmount: totalSubAmount,
      totalWorkedAmount: totalWorked,
      totalRemaining: totalSubAmount - totalWorked,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
