import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.4. Лиды по дням — количество созданных абонементов в каждый день */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    createdAt: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      createdAt: true,
      client: { select: { channelId: true } },
    },
  })

  // Group by day
  const byDay: Record<string, Record<string, number>> = {}
  for (const s of subs) {
    const day = s.createdAt.toISOString().split("T")[0]
    const channel = s.client.channelId || "unknown"
    if (!byDay[day]) byDay[day] = {}
    byDay[day][channel] = (byDay[day][channel] || 0) + 1
  }

  const data = Object.entries(byDay)
    .map(([date, channels]) => ({
      date,
      total: Object.values(channels).reduce((s, v) => s + v, 0),
      byChannel: channels,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    data,
    metadata: {
      totalLeads: subs.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
