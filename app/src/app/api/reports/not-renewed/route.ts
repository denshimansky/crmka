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

  // Развилка по типу абонемента.
  // calendar: «не продлил» = был в M-1, нет в M.
  // package: «не продлил» = пакет истёк в M-1 (expiresAt в диапазоне prevMonth)
  //          и нет нового пакета того же (client, direction) со startDate
  //          в окне [expiresAt - 7 дней, ...).
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackage = org?.subscriptionType === "package"

  const prevStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1))
  const prevEnd = new Date(Date.UTC(prevYear, prevMonth, 0, 23, 59, 59, 999))
  const currentStart = new Date(Date.UTC(year, month - 1, 1))
  const currentEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    status: { in: ["active", "closed"] },
    ...(isPackage
      ? {
          type: "package",
          expiresAt: { gte: prevStart, lte: prevEnd },
        }
      : { periodYear: prevYear, periodMonth: prevMonth }),
  }
  if (directionId) subWhere.directionId = directionId

  const lastMonthSubs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      directionId: true,
      finalAmount: true,
      expiresAt: true,
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

  // Текущие абонементы. Для package — пакеты, начатые в окне «истечение −7 дней
  // → текущий месяц включительно» (продлевался почти сразу).
  const currentMonthSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(isPackage
        ? {
            type: "package",
            startDate: {
              gte: new Date(prevStart.getTime() - 7 * 24 * 60 * 60 * 1000),
              lte: currentEnd,
            },
          }
        : { periodYear: year, periodMonth: month }),
    },
    select: { clientId: true, directionId: true, startDate: true },
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
