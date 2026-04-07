import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.5. Пробники по дням */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const trialWhere: any = {
    tenantId,
    scheduledDate: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) trialWhere.group = { branchId }

  const trials = await db.trialLesson.findMany({
    where: trialWhere,
    select: {
      status: true,
      scheduledDate: true,
      createdAt: true,
      clientId: true,
      client: { select: { channelId: true, firstPaymentDate: true, saleDate: true } },
    },
  })

  // Group by day of creation (when admin scheduled it)
  const byDay: Record<string, { scheduled: number; attended: number; purchased: number }> = {}
  for (const t of trials) {
    const day = t.createdAt.toISOString().split("T")[0]
    if (!byDay[day]) byDay[day] = { scheduled: 0, attended: 0, purchased: 0 }
    byDay[day].scheduled += 1
    if (t.status === "attended") byDay[day].attended += 1
    if (t.client.saleDate || t.client.firstPaymentDate) byDay[day].purchased += 1
  }

  const data = Object.entries(byDay)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    data,
    metadata: {
      total: trials.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
