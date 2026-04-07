import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.9. Остатки оплаченных занятий */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
    status: { in: ["active", "pending"] },
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      totalLessons: true,
      lessonPrice: true,
      balance: true,
      chargedAmount: true,
      finalAmount: true,
      endDate: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          clientStatus: true,
        },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  // Count attended lessons per subscription
  const subIds = subs.map((s) => s.id)
  const attendanceCounts = await db.attendance.groupBy({
    by: ["subscriptionId"],
    where: {
      tenantId,
      subscriptionId: { in: subIds },
      chargeAmount: { gt: 0 },
    },
    _count: true,
  })
  const countMap = new Map(attendanceCounts.map((a) => [a.subscriptionId, a._count]))

  const data = subs.map((s) => {
    const attended = countMap.get(s.id) || 0
    const remaining = Math.max(0, s.totalLessons - attended)
    const balanceToday = Number(s.balance)

    return {
      clientId: s.client.id,
      clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: s.direction.name,
      group: s.group.name,
      totalLessons: s.totalLessons,
      attendedLessons: attended,
      remainingLessons: remaining,
      balanceToday,
      endDate: s.endDate?.toISOString() || null,
      isActive: s.client.clientStatus === "active",
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => a.remainingLessons - b.remainingLessons),
    metadata: {
      totalSubscriptions: subs.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateRange.dateTo.toISOString(),
    },
  })
}
