import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide } from "@/lib/report-helpers"

/** 1.4. Средняя стоимость абонемента = Сумма отработанных / Кол-во активных абонементов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  // Active subscriptions = those with at least 1 charge in period
  const attendanceWhere: any = {
    tenantId,
    chargeAmount: { gt: 0 },
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) attendanceWhere.lesson = { ...attendanceWhere.lesson, group: { branchId } }
  if (directionId) attendanceWhere.subscription = { directionId }

  const attendances = await db.attendance.findMany({
    where: attendanceWhere,
    select: {
      subscriptionId: true,
      chargeAmount: true,
      subscription: {
        select: {
          direction: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Group by subscription
  const subCharges = new Map<string, { total: number; directionId: string; directionName: string }>()
  for (const a of attendances) {
    if (!a.subscriptionId) continue
    const prev = subCharges.get(a.subscriptionId) || {
      total: 0,
      directionId: a.subscription?.direction?.id || "unknown",
      directionName: a.subscription?.direction?.name || "Без направления",
    }
    prev.total += Number(a.chargeAmount)
    subCharges.set(a.subscriptionId, prev)
  }

  const activeCount = subCharges.size
  const totalCharged = [...subCharges.values()].reduce((s, v) => s + v.total, 0)
  const avgCost = safeDivide(totalCharged, activeCount)

  // By direction
  const byDirection: Record<string, { count: number; total: number; avg: number }> = {}
  for (const [, v] of subCharges) {
    if (!byDirection[v.directionName]) {
      byDirection[v.directionName] = { count: 0, total: 0, avg: 0 }
    }
    byDirection[v.directionName].count += 1
    byDirection[v.directionName].total += v.total
  }
  for (const k of Object.keys(byDirection)) {
    byDirection[k].avg = safeDivide(byDirection[k].total, byDirection[k].count)
  }

  return NextResponse.json({
    data: Object.entries(byDirection)
      .map(([direction, d]) => ({ direction, ...d }))
      .sort((a, b) => b.total - a.total),
    metadata: {
      activeSubscriptions: activeCount,
      totalCharged,
      avgSubscriptionCost: avgCost,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
