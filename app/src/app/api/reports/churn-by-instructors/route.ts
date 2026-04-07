import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide, pct } from "@/lib/report-helpers"

/** 2.2. Конверсия оттока по педагогам */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const groupByParam = searchParams.get("groupBy") || "instructor" // instructor | branch

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Active subscriptions in period (with at least 1 charge)
  const activeAtt = await db.attendance.findMany({
    where: {
      tenantId,
      chargeAmount: { gt: 0 },
      lesson: { date: { gte: dateFrom, lte: dateTo } },
    },
    select: {
      subscriptionId: true,
      lesson: {
        select: {
          instructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
          group: { select: { branchId: true, branch: { select: { name: true } } } },
        },
      },
    },
  })

  // Churned clients in period
  const churned = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      clientStatus: "churned",
      withdrawalDate: { gte: dateFrom, lte: dateTo },
    },
    select: {
      id: true,
      subscriptions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          group: {
            select: {
              instructorId: true,
              branchId: true,
            },
          },
        },
      },
    },
  })

  if (groupByParam === "instructor") {
    // Group active subs by instructor
    const instrActive = new Map<string, { name: string; subs: Set<string> }>()
    for (const a of activeAtt) {
      if (!a.subscriptionId) continue
      const iId = a.lesson.instructorId
      const prev = instrActive.get(iId) || {
        name: [a.lesson.instructor.lastName, a.lesson.instructor.firstName].filter(Boolean).join(" "),
        subs: new Set(),
      }
      prev.subs.add(a.subscriptionId)
      instrActive.set(iId, prev)
    }

    // Count churned by instructor
    const instrChurned = new Map<string, number>()
    for (const c of churned) {
      const iId = c.subscriptions[0]?.group?.instructorId
      if (iId) instrChurned.set(iId, (instrChurned.get(iId) || 0) + 1)
    }

    const data = [...instrActive.entries()]
      .filter(([, v]) => v.subs.size > 0)
      .map(([id, v]) => ({
        instructorId: id,
        instructorName: v.name,
        activeSubscriptions: v.subs.size,
        churned: instrChurned.get(id) || 0,
        churnRate: pct(instrChurned.get(id) || 0, v.subs.size),
      }))
      .sort((a, b) => b.churnRate - a.churnRate)

    return NextResponse.json({ data, metadata: { groupBy: "instructor", dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
  }

  // Group by branch
  const branchActive = new Map<string, { name: string; subs: Set<string> }>()
  for (const a of activeAtt) {
    if (!a.subscriptionId) continue
    const bId = a.lesson.group.branchId
    const prev = branchActive.get(bId) || {
      name: a.lesson.group.branch.name,
      subs: new Set(),
    }
    prev.subs.add(a.subscriptionId)
    branchActive.set(bId, prev)
  }

  const branchChurned = new Map<string, number>()
  for (const c of churned) {
    const bId = c.subscriptions[0]?.group?.branchId
    if (bId) branchChurned.set(bId, (branchChurned.get(bId) || 0) + 1)
  }

  const data = [...branchActive.entries()]
    .filter(([, v]) => v.subs.size > 0)
    .map(([id, v]) => ({
      branchId: id,
      branchName: v.name,
      activeSubscriptions: v.subs.size,
      churned: branchChurned.get(id) || 0,
      churnRate: pct(branchChurned.get(id) || 0, v.subs.size),
    }))
    .sort((a, b) => b.churnRate - a.churnRate)

  return NextResponse.json({ data, metadata: { groupBy: "branch", dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
}
