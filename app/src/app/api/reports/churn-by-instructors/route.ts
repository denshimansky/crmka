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

  // Выбывшие абонементы в периоде (Subscription.withdrawalDate). Раньше отток
  // считался по Client.clientStatus='churned' (полное отчисление клиента) — этот
  // флаг в базе почти не проставляется (выбывает отдельный абонемент, а не весь
  // клиент), поэтому отчёт показывал нули, хотя абонементы выбывали. Считаем по
  // абонементам — согласованно со знаменателем (активные абонементы) и с отчётом
  // «Сводный по абонементам в разрезе педагогов» (баг #35).
  const churnedSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      withdrawalDate: { gte: dateFrom, lte: dateTo },
    },
    select: {
      group: {
        select: {
          instructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
          branchId: true,
          branch: { select: { name: true } },
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

    // Count churned subscriptions by instructor (по группе абонемента). Педагога
    // с оттоком, но без активных абонементов в периоде, тоже включаем.
    const instrChurned = new Map<string, number>()
    for (const s of churnedSubs) {
      const iId = s.group?.instructorId
      if (!iId) continue
      instrChurned.set(iId, (instrChurned.get(iId) || 0) + 1)
      if (!instrActive.has(iId)) {
        instrActive.set(iId, {
          name: [s.group.instructor?.lastName, s.group.instructor?.firstName].filter(Boolean).join(" "),
          subs: new Set(),
        })
      }
    }

    const data = [...instrActive.entries()]
      .filter(([id, v]) => v.subs.size > 0 || (instrChurned.get(id) ?? 0) > 0)
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
  for (const s of churnedSubs) {
    const bId = s.group?.branchId
    if (!bId) continue
    branchChurned.set(bId, (branchChurned.get(bId) || 0) + 1)
    if (!branchActive.has(bId)) {
      branchActive.set(bId, { name: s.group.branch?.name ?? "—", subs: new Set() })
    }
  }

  const data = [...branchActive.entries()]
    .filter(([id, v]) => v.subs.size > 0 || (branchChurned.get(id) ?? 0) > 0)
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
