import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 2.4. Отток по направлениям и филиалам — дерево: Общее → филиалы → направления. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  // Активные = абонементы прошлого месяца. Отток = те, по кому в текущем месяце нет
  // нового абонемента того же клиента и направления.
  const prevSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: prevYear,
      periodMonth: prevMonth,
      status: { in: ["active", "closed"] },
    },
    select: {
      clientId: true,
      directionId: true,
      direction: { select: { name: true } },
      group: { select: { branchId: true, branch: { select: { name: true } } } },
    },
  })

  const curSubs = await db.subscription.findMany({
    where: { tenantId, deletedAt: null, periodYear: year, periodMonth: month },
    select: { clientId: true, directionId: true },
  })
  const renewedSet = new Set(curSubs.map((s) => `${s.clientId}:${s.directionId}`))

  interface Agg {
    active: number
    churned: number
  }
  const total: Agg = { active: 0, churned: 0 }
  const branchMap = new Map<
    string,
    { name: string; agg: Agg; dirs: Map<string, { name: string; agg: Agg }> }
  >()

  for (const s of prevSubs) {
    const churned = !renewedSet.has(`${s.clientId}:${s.directionId}`)
    total.active += 1
    if (churned) total.churned += 1

    const branchId = s.group?.branchId ?? "none"
    const branchName = s.group?.branch?.name ?? "Без филиала"
    let b = branchMap.get(branchId)
    if (!b) {
      b = { name: branchName, agg: { active: 0, churned: 0 }, dirs: new Map() }
      branchMap.set(branchId, b)
    }
    b.agg.active += 1
    if (churned) b.agg.churned += 1

    let d = b.dirs.get(s.directionId)
    if (!d) {
      d = { name: s.direction.name, agg: { active: 0, churned: 0 } }
      b.dirs.set(s.directionId, d)
    }
    d.agg.active += 1
    if (churned) d.agg.churned += 1
  }

  const node = (id: string, name: string, agg: Agg) => ({
    id,
    name,
    activeSubscriptions: agg.active,
    churned: agg.churned,
    churnRate: pct(agg.churned, agg.active),
  })

  const branches = [...branchMap.entries()]
    .map(([id, b]) => ({
      ...node(id, b.name, b.agg),
      directions: [...b.dirs.entries()]
        .map(([did, d]) => node(did, d.name, d.agg))
        .sort((a, z) => z.churnRate - a.churnRate),
    }))
    .sort((a, z) => z.churnRate - a.churnRate)

  return NextResponse.json({
    data: {
      total: {
        activeSubscriptions: total.active,
        churned: total.churned,
        churnRate: pct(total.churned, total.active),
      },
      branches,
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
