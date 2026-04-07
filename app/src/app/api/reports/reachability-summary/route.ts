import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.8. Доходимость (свод) — детализация до ФИО */
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
      direction: { select: { name: true } },
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          funnelStatus: true,
          firstPaymentDate: true,
          saleDate: true,
        },
      },
    },
  })

  const clientIds = [...new Set(subs.map((s) => s.clientId))]

  // Trial data
  const trials = await db.trialLesson.findMany({
    where: { tenantId, clientId: { in: clientIds } },
    select: { clientId: true, status: true, scheduledDate: true },
  })

  const trialMap = new Map<string, { scheduled: boolean; attended: boolean; scheduledDate: Date | null }>()
  for (const t of trials) {
    const prev = trialMap.get(t.clientId) || { scheduled: false, attended: false, scheduledDate: null }
    prev.scheduled = true
    if (!prev.scheduledDate) prev.scheduledDate = t.scheduledDate
    if (t.status === "attended") prev.attended = true
    trialMap.set(t.clientId, prev)
  }

  // Payment data
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

  const data = subs.map((s) => {
    const trial = trialMap.get(s.clientId)
    return {
      clientId: s.client.id,
      clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: s.direction.name,
      createdAt: s.createdAt.toISOString(),
      funnelStatus: s.client.funnelStatus,
      trialScheduled: trial?.scheduled || false,
      trialDate: trial?.scheduledDate?.toISOString() || null,
      trialAttended: trial?.attended || false,
      sold: !!(s.client.saleDate || s.client.firstPaymentDate),
      paid: paidClients.has(s.clientId),
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      total: subs.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
