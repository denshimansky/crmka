import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 2.4. Отток по направлениям (и филиалам) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const groupBy = searchParams.get("groupBy") || "direction" // direction | branch

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  // Active subscriptions = had charges both prev and current month
  const subWhere: any = { tenantId, deletedAt: null }
  if (branchId) subWhere.group = { branchId }

  const prevSubs = await db.subscription.findMany({
    where: { ...subWhere, periodYear: prevYear, periodMonth: prevMonth, status: { in: ["active", "closed"] } },
    select: {
      id: true,
      clientId: true,
      directionId: true,
      direction: { select: { name: true } },
      group: { select: { branchId: true, branch: { select: { name: true } } } },
    },
  })

  const curSubs = await db.subscription.findMany({
    where: { ...subWhere, periodYear: year, periodMonth: month },
    select: { clientId: true, directionId: true },
  })

  const renewedSet = new Set(curSubs.map((s) => `${s.clientId}:${s.directionId}`))

  // Group key function
  const getKey = (s: typeof prevSubs[0]) =>
    groupBy === "branch"
      ? s.group.branch.name
      : s.direction.name

  const groups = new Map<string, { active: number; churned: number; completedCourse: number }>()

  for (const s of prevSubs) {
    const key = getKey(s)
    const prev = groups.get(key) || { active: 0, churned: 0, completedCourse: 0 }
    prev.active += 1
    if (!renewedSet.has(`${s.clientId}:${s.directionId}`)) {
      prev.churned += 1
    }
    groups.set(key, prev)
  }

  const data = [...groups.entries()]
    .map(([name, v]) => ({
      name,
      activeSubscriptions: v.active,
      churned: v.churned,
      churnRate: pct(v.churned, v.active),
      completedCourse: v.completedCourse,
    }))
    .sort((a, b) => b.churnRate - a.churnRate)

  return NextResponse.json({
    data,
    metadata: {
      groupBy,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
