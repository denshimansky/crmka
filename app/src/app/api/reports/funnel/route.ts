import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const clientWhere: any = { tenantId, deletedAt: null }
  if (branchId) clientWhere.branchId = branchId

  const allClients = await db.client.findMany({
    where: clientWhere,
    select: { funnelStatus: true, createdAt: true, firstPaymentDate: true },
  })

  const totalClients = allClients.length

  // Block 1: Current period funnel (new leads created in period)
  const periodClients = allClients.filter(
    (c) => c.createdAt >= dateFrom && c.createdAt <= dateTo
  )

  const funnelStages = [
    "new",
    "trial_scheduled",
    "trial_attended",
    "awaiting_payment",
    "active_client",
  ]

  const periodStatusCounts: Record<string, number> = {}
  for (const c of periodClients) {
    periodStatusCounts[c.funnelStatus] = (periodStatusCounts[c.funnelStatus] || 0) + 1
  }

  const funnelData = funnelStages.map((status) => ({
    status,
    count: periodStatusCounts[status] || 0,
  }))

  // Block 2: Carryover from previous periods
  const carryoverStatuses = [
    "new",
    "trial_scheduled",
    "trial_attended",
    "awaiting_payment",
    "potential",
  ]
  const carryoverClients = allClients.filter(
    (c) => c.createdAt < dateFrom && carryoverStatuses.includes(c.funnelStatus)
  )
  const carryoverCounts: Record<string, number> = {}
  for (const c of carryoverClients) {
    carryoverCounts[c.funnelStatus] = (carryoverCounts[c.funnelStatus] || 0) + 1
  }

  // Metrics
  const newThisPeriod = periodClients.length
  const convertedThisPeriod = allClients.filter(
    (c) =>
      c.firstPaymentDate &&
      c.firstPaymentDate >= dateFrom &&
      c.firstPaymentDate <= dateTo
  ).length

  return NextResponse.json({
    data: {
      funnel: funnelData,
      carryover: carryoverCounts,
    },
    metadata: {
      totalClients,
      newThisPeriod,
      convertedThisPeriod,
      conversionRate: pct(
        allClients.filter((c) => c.funnelStatus === "active_client").length,
        totalClients
      ),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
