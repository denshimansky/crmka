import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 3.3. Конверсия пробных по педагогам */
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
    status: "attended",
    groupId: { not: null }, // отчёт по педагогам — только групповые пробные
  }
  if (branchId) trialWhere.group = { branchId }

  // Trials attended
  const trials = await db.trialLesson.findMany({
    where: trialWhere,
    select: {
      clientId: true,
      group: {
        select: {
          instructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  // Clients who attended trials and then made a purchase
  // Purchase = first paid lesson attended OR first payment
  const trialClientIds = [...new Set(trials.map((t) => t.clientId))]

  const purchasedClients = await db.client.findMany({
    where: {
      id: { in: trialClientIds },
      tenantId,
      deletedAt: null,
      OR: [
        { firstPaymentDate: { not: null } },
        { firstPaidLessonDate: { not: null } },
      ],
    },
    select: { id: true },
  })
  const purchasedSet = new Set(purchasedClients.map((c) => c.id))

  // Group by instructor
  const instrData = new Map<string, { name: string; trials: number; sales: number }>()
  for (const t of trials) {
    if (!t.group) continue // защита: индивидуальные пробные сюда не должны попасть
    const iId = t.group.instructorId
    const prev = instrData.get(iId) || {
      name: [t.group.instructor.lastName, t.group.instructor.firstName].filter(Boolean).join(" "),
      trials: 0,
      sales: 0,
    }
    prev.trials += 1
    if (purchasedSet.has(t.clientId)) prev.sales += 1
    instrData.set(iId, prev)
  }

  const data = [...instrData.entries()]
    .map(([id, v]) => ({
      instructorId: id,
      instructorName: v.name,
      trialsAttended: v.trials,
      sales: v.sales,
      conversionRate: pct(v.sales, v.trials),
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate)

  return NextResponse.json({
    data,
    metadata: {
      totalTrials: trials.length,
      totalSales: [...instrData.values()].reduce((s, v) => s + v.sales, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
