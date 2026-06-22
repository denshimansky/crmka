import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 2.1. Детализация оттока */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  // Отток считаем по ВЫБЫВШИМ АБОНЕМЕНТАМ (Subscription.withdrawalDate = дата
  // последнего платного занятия), а не по Client.withdrawalDate (его кроны ставят
  // датой запуска). Так отчёт согласован со спекой (reports-logic §2.1) и с
  // «Отток по педагогам». Клиент попадает в список, если у него есть выбывший
  // абонемент с датой отчисления в периоде.
  const subWhere: any = {
    deletedAt: null,
    status: "withdrawn",
    withdrawalDate: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) subWhere.directionId = directionId

  const where: any = {
    tenantId,
    deletedAt: null,
    subscriptions: { some: subWhere },
  }
  if (branchId) where.branchId = branchId

  const churnedClients = await db.client.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      branch: { select: { name: true } },
      subscriptions: {
        where: subWhere,
        orderBy: { withdrawalDate: "desc" },
        take: 1,
        select: {
          withdrawalDate: true,
          direction: { select: { id: true, name: true } },
          group: {
            select: {
              instructor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  })

  const filtered = churnedClients

  const totalActive = await db.client.count({
    where: { tenantId, deletedAt: null, clientStatus: "active" },
  })

  const totalChurned = filtered.length

  // By direction
  const byDirection: Record<string, number> = {}
  for (const c of filtered) {
    const dir = c.subscriptions[0]?.direction?.name || "Без направления"
    byDirection[dir] = (byDirection[dir] || 0) + 1
  }

  // By branch
  const byBranch: Record<string, number> = {}
  for (const c of filtered) {
    const br = c.branch?.name || "Без филиала"
    byBranch[br] = (byBranch[br] || 0) + 1
  }

  const data = filtered
    .map((c) => ({
      clientId: c.id,
      clientName: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
      branch: c.branch?.name || null,
      direction: c.subscriptions[0]?.direction?.name || null,
      instructor: c.subscriptions[0]?.group?.instructor
        ? [c.subscriptions[0].group.instructor.lastName, c.subscriptions[0].group.instructor.firstName]
            .filter(Boolean)
            .join(" ")
        : null,
      withdrawalDate: c.subscriptions[0]?.withdrawalDate?.toISOString() || null,
    }))
    .sort((a, b) => (b.withdrawalDate || "").localeCompare(a.withdrawalDate || ""))

  return NextResponse.json({
    data,
    metadata: {
      totalChurned,
      totalActive,
      churnRate: pct(totalChurned, totalActive + totalChurned),
      byDirection,
      byBranch,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
