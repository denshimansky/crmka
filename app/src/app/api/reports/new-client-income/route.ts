import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 10.1. Доход от новых клиентов / упущенный доход по выбывшим */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  // New clients = first paid lesson in period OR first payment in period
  const newClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { firstPaidLessonDate: { gte: dateFrom, lte: dateTo } },
        { firstPaymentDate: { gte: dateFrom, lte: dateTo } },
      ],
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  })

  // Revenue from new clients in period
  const newClientIds = newClients.map((c) => c.id)
  const newAttWhere: any = {
    tenantId,
    clientId: { in: newClientIds },
    chargeAmount: { gt: 0 },
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (directionId) newAttWhere.subscription = { directionId }

  const newAttendances = await db.attendance.findMany({
    where: newAttWhere,
    select: { chargeAmount: true },
  })
  const newClientIncome = newAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Churned clients in period — by last paid lesson date
  const churnedClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      clientStatus: "churned",
      withdrawalDate: { gte: dateFrom, lte: dateTo },
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  })

  const churnedIds = churnedClients.map((c) => c.id)

  // Lost revenue = subscriptions of churned clients for current month, remaining amount
  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const churnedSubWhere: any = {
    tenantId,
    deletedAt: null,
    clientId: { in: churnedIds },
    periodYear: year,
    periodMonth: month,
  }
  if (directionId) churnedSubWhere.directionId = directionId

  const churnedSubs = await db.subscription.findMany({
    where: churnedSubWhere,
    select: { finalAmount: true, chargedAmount: true },
  })

  const lostRevenueCurrent = churnedSubs.reduce(
    (s, sub) => s + (Number(sub.finalAmount) - Number(sub.chargedAmount)),
    0
  )

  // Next month forecast for churned (avg subscription cost as proxy)
  const avgSubAgg = await db.subscription.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: year,
      periodMonth: month,
      status: { in: ["active", "closed"] },
    },
    _avg: { finalAmount: true },
  })
  const avgSubCost = Number(avgSubAgg._avg.finalAmount || 0)
  const lostRevenueNextMonth = churnedClients.length * avgSubCost

  return NextResponse.json({
    data: {
      newClients: {
        count: newClients.length,
        income: Math.round(newClientIncome),
      },
      churnedClients: {
        count: churnedClients.length,
        lostRevenueCurrent: Math.round(lostRevenueCurrent),
        lostRevenueNextMonth: Math.round(lostRevenueNextMonth),
      },
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
