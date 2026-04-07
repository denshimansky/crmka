import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 1.6. LTV клиентов в разрезах */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const clientWhere: any = { tenantId, deletedAt: null, clientStatus: "active" }
  if (branchId) clientWhere.branchId = branchId

  const clients = await db.client.findMany({
    where: clientWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      segment: true,
      moneyLtv: true,
      monthsLtv: true,
    },
  })

  // For each client, get attendance stats
  const clientIds = clients.map((c) => c.id)

  const attWhere: any = {
    tenantId,
    clientId: { in: clientIds },
    chargeAmount: { gt: 0 },
  }
  if (directionId) attWhere.subscription = { directionId }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      clientId: true,
      chargeAmount: true,
      lesson: { select: { date: true } },
      subscription: { select: { directionId: true } },
    },
  })

  // Payments
  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "incoming",
      clientId: { in: clientIds },
    },
    select: { clientId: true, amount: true },
  })

  // Aggregate per client
  const clientStats = new Map<
    string,
    {
      chargedLessons: number
      chargedAmount: number
      months: Set<string>
      directions: Set<string>
      totalPayments: number
    }
  >()

  for (const a of attendances) {
    let stats = clientStats.get(a.clientId)
    if (!stats) {
      stats = {
        chargedLessons: 0,
        chargedAmount: 0,
        months: new Set(),
        directions: new Set(),
        totalPayments: 0,
      }
      clientStats.set(a.clientId, stats)
    }
    stats.chargedLessons += 1
    stats.chargedAmount += Number(a.chargeAmount)
    const d = a.lesson.date
    stats.months.add(`${d.getFullYear()}-${d.getMonth()}`)
    if (a.subscription?.directionId) stats.directions.add(a.subscription.directionId)
  }

  for (const p of payments) {
    let stats = clientStats.get(p.clientId)
    if (!stats) {
      stats = {
        chargedLessons: 0,
        chargedAmount: 0,
        months: new Set(),
        directions: new Set(),
        totalPayments: 0,
      }
      clientStats.set(p.clientId, stats)
    }
    stats.totalPayments += Number(p.amount)
  }

  const data = clients.map((c) => {
    const stats = clientStats.get(c.id)
    return {
      clientId: c.id,
      clientName: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
      segment: c.segment,
      chargedLessons: stats?.chargedLessons || 0,
      monthsWithCharges: stats?.months.size || 0,
      directionsCount: stats?.directions.size || 0,
      totalPayments: stats?.totalPayments || 0,
      totalChargedAmount: stats?.chargedAmount || 0,
      moneyLtv: Number(c.moneyLtv),
      monthsLtv: c.monthsLtv,
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => b.totalPayments - a.totalPayments),
    metadata: {
      totalClients: clients.length,
    },
  })
}
