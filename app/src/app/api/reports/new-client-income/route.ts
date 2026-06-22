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

  // Выбывшие в периоде — по дате последнего платного занятия
  // (Subscription.withdrawalDate), а не по Client.withdrawalDate (его кроны ставят
  // датой запуска). Так согласуется со спекой и «Оттоком по педагогам».
  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const churnedSubWhere: any = {
    tenantId,
    deletedAt: null,
    status: "withdrawn",
    withdrawalDate: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) churnedSubWhere.client = { branchId }
  if (directionId) churnedSubWhere.directionId = directionId

  const churnedSubs = await db.subscription.findMany({
    where: churnedSubWhere,
    select: { clientId: true, finalAmount: true, chargedAmount: true },
  })

  // Уникальные клиенты с выбывшим абонементом в периоде.
  const churnedCount = new Set(churnedSubs.map((s) => s.clientId)).size

  // Упущенный доход = недоработанный остаток выбывших абонементов.
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
  const lostRevenueNextMonth = churnedCount * avgSubCost

  return NextResponse.json({
    data: {
      newClients: {
        count: newClients.length,
        income: Math.round(newClientIncome),
      },
      churnedClients: {
        count: churnedCount,
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
