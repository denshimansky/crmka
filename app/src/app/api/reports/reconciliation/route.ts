import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 1.7. Сверка актива (расхождения) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")
  const onlyDiscrepancies = searchParams.get("onlyDiscrepancies") === "true"

  // Active clients with their enrollments
  const clientWhere: any = {
    tenantId,
    deletedAt: null,
    clientStatus: "active",
  }
  if (branchId) clientWhere.branchId = branchId

  const clients = await db.client.findMany({
    where: clientWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { isActive: true, deletedAt: null },
        select: {
          group: {
            select: {
              name: true,
              direction: { select: { id: true, name: true } },
            },
          },
          ward: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  // Filter by direction
  const filteredClients = directionId
    ? clients.filter((c) =>
        c.enrollments.some((e) => e.group.direction.id === directionId)
      )
    : clients

  const clientIds = filteredClients.map((c) => c.id)

  // Payments in period
  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "incoming",
      clientId: { in: clientIds },
      date: { gte: dateFrom, lte: dateTo },
    },
    select: { clientId: true, subscriptionId: true },
  })
  const paidClientIds = new Set(payments.map((p) => p.clientId))

  // Activated subscriptions (has attendance with charge in period)
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      chargeAmount: { gt: 0 },
      lesson: { date: { gte: dateFrom, lte: dateTo } },
    },
    select: { clientId: true },
  })
  const activatedClientIds = new Set(attendances.map((a) => a.clientId))

  // Last visit per client
  const lastVisits = await db.attendance.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      attendanceType: { code: "present" },
    },
    select: { clientId: true, lesson: { select: { date: true } } },
    orderBy: { lesson: { date: "desc" } },
  })

  const lastVisitMap = new Map<string, Date>()
  for (const v of lastVisits) {
    if (!lastVisitMap.has(v.clientId)) {
      lastVisitMap.set(v.clientId, v.lesson.date)
    }
  }

  const now = new Date()
  const data = filteredClients.map((c) => {
    const hasPaid = paidClientIds.has(c.id)
    const isActivated = activatedClientIds.has(c.id)
    const lastVisit = lastVisitMap.get(c.id) || null
    const daysSinceVisit = lastVisit
      ? Math.floor((now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
      : null

    const hasDiscrepancy = !hasPaid && !isActivated

    return {
      clientId: c.id,
      clientName: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
      ward: c.enrollments[0]?.ward
        ? [c.enrollments[0].ward.lastName, c.enrollments[0].ward.firstName].filter(Boolean).join(" ")
        : null,
      direction: c.enrollments[0]?.group.direction.name || null,
      group: c.enrollments[0]?.group.name || null,
      isActive: true,
      hasPaid,
      isActivated,
      lastVisit: lastVisit?.toISOString() || null,
      daysSinceVisit,
      hasDiscrepancy,
    }
  })

  const filtered = onlyDiscrepancies ? data.filter((d) => d.hasDiscrepancy) : data
  const sorted = filtered.sort((a, b) => (b.daysSinceVisit || 0) - (a.daysSinceVisit || 0))

  return NextResponse.json({
    data: sorted,
    metadata: {
      totalActive: filteredClients.length,
      totalDiscrepancies: data.filter((d) => d.hasDiscrepancy).length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
