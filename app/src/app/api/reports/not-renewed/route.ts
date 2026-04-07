import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Previous month
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: prevYear,
    periodMonth: prevMonth,
    status: { in: ["active", "closed"] },
  }
  if (directionId) subWhere.directionId = directionId

  const lastMonthSubs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      directionId: true,
      finalAmount: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          branchId: true,
        },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  // Filter by branch if needed
  const filteredLastMonth = branchId
    ? lastMonthSubs.filter((s) => s.client.branchId === branchId)
    : lastMonthSubs

  // Current month subscriptions
  const currentMonthSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: year,
      periodMonth: month,
    },
    select: { clientId: true, directionId: true },
  })

  const renewedSet = new Set(
    currentMonthSubs.map((s) => `${s.clientId}:${s.directionId}`)
  )

  const notRenewed = filteredLastMonth.filter(
    (s) => !renewedSet.has(`${s.clientId}:${s.directionId}`)
  )

  const totalLastMonth = filteredLastMonth.length
  const totalNotRenewed = notRenewed.length
  const renewalRate = pct(totalLastMonth - totalNotRenewed, totalLastMonth)
  const lostRevenue = notRenewed.reduce((s, sub) => s + Number(sub.finalAmount), 0)

  // By direction
  const byDirection: Record<string, number> = {}
  for (const s of notRenewed) {
    const dir = s.direction.name
    byDirection[dir] = (byDirection[dir] || 0) + 1
  }

  const data = notRenewed.map((s) => ({
    clientId: s.client.id,
    clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
    phone: s.client.phone || null,
    direction: s.direction.name,
    group: s.group.name,
    amount: Number(s.finalAmount),
  }))

  return NextResponse.json({
    data,
    metadata: {
      totalLastMonth,
      totalNotRenewed,
      renewalRate,
      lostRevenue,
      byDirection,
      prevYear,
      prevMonth,
      dateFrom: dateRange.dateFrom.toISOString(),
      dateTo: dateRange.dateTo.toISOString(),
    },
  })
}
