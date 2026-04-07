import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.7. Доходимость (по дням) — привязано к дате создания абонемента */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    createdAt: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      createdAt: true,
      client: {
        select: {
          funnelStatus: true,
          firstPaymentDate: true,
          saleDate: true,
        },
      },
    },
  })

  // Trial lessons for these clients
  const clientIds = [...new Set(subs.map((s) => s.clientId))]
  const trials = await db.trialLesson.findMany({
    where: { tenantId, clientId: { in: clientIds } },
    select: { clientId: true, status: true },
  })

  const trialMap = new Map<string, { scheduled: boolean; attended: boolean }>()
  for (const t of trials) {
    const prev = trialMap.get(t.clientId) || { scheduled: false, attended: false }
    prev.scheduled = true
    if (t.status === "attended") prev.attended = true
    trialMap.set(t.clientId, prev)
  }

  // Payments for these clients
  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "incoming",
      clientId: { in: clientIds },
    },
    select: { clientId: true },
  })
  const paidClients = new Set(payments.map((p) => p.clientId))

  // Group by day of subscription creation
  const byDay: Record<
    string,
    { created: number; trialScheduled: number; trialAttended: number; sold: number; paid: number }
  > = {}

  for (const s of subs) {
    const day = s.createdAt.toISOString().split("T")[0]
    if (!byDay[day]) {
      byDay[day] = { created: 0, trialScheduled: 0, trialAttended: 0, sold: 0, paid: 0 }
    }
    byDay[day].created += 1

    const trial = trialMap.get(s.clientId)
    if (trial?.scheduled) byDay[day].trialScheduled += 1
    if (trial?.attended) byDay[day].trialAttended += 1
    if (s.client.saleDate || s.client.firstPaymentDate) byDay[day].sold += 1
    if (paidClients.has(s.clientId)) byDay[day].paid += 1
  }

  const data = Object.entries(byDay)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    data,
    metadata: {
      totalCreated: subs.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
