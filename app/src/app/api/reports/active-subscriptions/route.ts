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
  const directionId = searchParams.get("directionId")
  const instructorId = searchParams.get("instructorId")
  const groupBy = searchParams.get("groupBy") || "branch" // branch | instructor | total

  // Current period dates
  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Previous month
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  // Get attendances with charges in current month (= active subscription)
  const currentWhere: any = {
    tenantId,
    chargeAmount: { gt: 0 },
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) currentWhere.lesson = { ...currentWhere.lesson, group: { branchId } }
  if (directionId) currentWhere.subscription = { directionId }
  if (instructorId) currentWhere.lesson = { ...currentWhere.lesson, instructorId }

  const currentAttendances = await db.attendance.findMany({
    where: currentWhere,
    select: {
      subscriptionId: true,
      clientId: true,
      lesson: {
        select: {
          instructorId: true,
          group: {
            select: {
              branchId: true,
              branch: { select: { name: true } },
              direction: { select: { name: true } },
              instructor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  })

  // Active subscriptions this month (unique subscriptionIds with charges)
  const activeSubIds = new Set(currentAttendances.filter((a) => a.subscriptionId).map((a) => a.subscriptionId!))

  // Previous month attendances with charges
  const prevMonthStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1))
  const prevMonthEnd = new Date(Date.UTC(prevYear, prevMonth, 0, 23, 59, 59))

  const prevAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      chargeAmount: { gt: 0 },
      lesson: { date: { gte: prevMonthStart, lte: prevMonthEnd } },
    },
    select: { subscriptionId: true },
  })

  const prevSubIds = new Set(prevAttendances.filter((a) => a.subscriptionId).map((a) => a.subscriptionId!))

  // Renewed = had charge in prev AND current month
  const renewedSubIds = new Set([...activeSubIds].filter((id) => prevSubIds.has(id)))

  // Active at end of month (still active today or last day)
  const activeAtEnd = activeSubIds.size // approximation: all with charges are active

  return NextResponse.json({
    data: {
      activeSubscriptions: activeSubIds.size,
      renewedSubscriptions: renewedSubIds.size,
      activeAtEndOfMonth: activeAtEnd,
    },
    metadata: {
      year,
      month,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
