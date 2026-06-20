import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.5. Лиды по каналам — созданные заявки (абонементы) по каналам × дням.
 *  «Лид» = созданный абонемент (как в «Лиды по дням»), канал — из карточки клиента. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    createdAt: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      createdAt: true,
      client: { select: { channelId: true } },
    },
  })

  // Справочник каналов (включая неактивные — чтобы имена резолвились)
  const channels = await db.leadChannel.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })
  const channelName = new Map(channels.map((c) => [c.id, c.name]))

  const NO_CHANNEL = "__none__"

  // канал → день(ISO) → количество
  const byChannel = new Map<string, Map<string, number>>()
  const daySet = new Set<string>()
  for (const s of subs) {
    const day = s.createdAt.toISOString().split("T")[0]
    daySet.add(day)
    const ch = s.client.channelId || NO_CHANNEL
    if (!byChannel.has(ch)) byChannel.set(ch, new Map())
    const m = byChannel.get(ch)!
    m.set(day, (m.get(day) || 0) + 1)
  }

  const days = [...daySet].sort((a, b) => a.localeCompare(b))

  const data = [...byChannel.entries()]
    .map(([channelId, m]) => {
      const perDay = days.map((d) => m.get(d) || 0)
      return {
        channelId,
        channel:
          channelId === NO_CHANNEL ? "Без канала" : channelName.get(channelId) || "—",
        total: perDay.reduce((s, v) => s + v, 0),
        perDay,
      }
    })
    .sort((a, b) => b.total - a.total)

  const totalsPerDay = days.map((_, i) => data.reduce((s, r) => s + r.perDay[i], 0))

  return NextResponse.json({
    data,
    metadata: {
      days,
      totalsPerDay,
      totalLeads: subs.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
