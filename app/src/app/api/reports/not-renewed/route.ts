import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import { findNotRenewedSubscriptions } from "@/lib/reports/not-renewed"

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

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackage = org?.subscriptionType === "package"

  // Единый источник истины «непродлённых» (см. lib/reports/not-renewed).
  const { prevYear, prevMonth, lastMonthSubs, notRenewed: allNotRenewed } =
    await findNotRenewedSubscriptions(db, tenantId, {
      year,
      month,
      isPackage,
      directionId: directionId || undefined,
    })

  // Фильтр по филиалу — по денормализованному client.branchId (как и раньше).
  const byBranch = <T extends { client: { branchId: string | null } }>(arr: T[]) =>
    branchId ? arr.filter((s) => s.client.branchId === branchId) : arr
  const filteredLastMonth = byBranch(lastMonthSubs)
  const notRenewed = byBranch(allNotRenewed)

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
