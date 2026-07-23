import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.5. Лиды по каналам — созданные ЛИДЫ (контакты, вошедшие в статус «Новый»)
 *  по каналам привлечения × дням месяца.
 *
 *  «Лид» = `Client.becameLeadAt` в периоде — ровно как в «Воронке»
 *  (lib/reports/sales-funnel.ts) и «Лидах по менеджерам»: считаем СОЗДАНИЕ лида,
 *  а НЕ абонемент/заявку. Один контакт учитывается один раз (в месяце своего
 *  becameLeadAt), независимо от текущего статуса. Импортированные сразу
 *  активными/потенциалом/архивом (becameLeadAt=NULL) новыми лидами не считаются.
 *  Канал — из карточки клиента; лиды без канала — строка «Без канала». */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      becameLeadAt: { gte: dateFrom, lte: dateTo },
    },
    select: { becameLeadAt: true, channelId: true },
  })

  // Справочник каналов (включая неактивные — чтобы имена резолвились)
  const channels = await db.leadChannel.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })
  const channelName = new Map(channels.map((c) => [c.id, c.name]))

  const NO_CHANNEL = "__none__"

  // канал → день(ISO) → количество новых лидов
  const byChannel = new Map<string, Map<string, number>>()
  const daySet = new Set<string>()
  for (const c of clients) {
    // becameLeadAt гарантированно не null (фильтр по диапазону выше)
    const day = c.becameLeadAt!.toISOString().split("T")[0]
    daySet.add(day)
    const ch = c.channelId || NO_CHANNEL
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
      totalLeads: clients.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
