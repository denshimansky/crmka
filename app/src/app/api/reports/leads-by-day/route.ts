import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.4. Лиды по дням — количество созданных ЛИДОВ (контактов, вошедших в статус
 *  «Новый») в каждый день месяца.
 *
 *  «Лид» = `Client.becameLeadAt` в периоде — как в «Воронке» и «Лидах по каналам»:
 *  считаем СОЗДАНИЕ лида, а НЕ абонемент/заявку. Один контакт — один раз (в месяце
 *  своего becameLeadAt), независимо от текущего статуса. Импортированные сразу
 *  активными/архивом (becameLeadAt=NULL) новыми лидами не считаются. */
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

  // Группируем по дню (becameLeadAt гарантированно не null — фильтр по диапазону)
  const byDay: Record<string, Record<string, number>> = {}
  for (const c of clients) {
    const day = c.becameLeadAt!.toISOString().split("T")[0]
    const channel = c.channelId || "unknown"
    if (!byDay[day]) byDay[day] = {}
    byDay[day][channel] = (byDay[day][channel] || 0) + 1
  }

  const data = Object.entries(byDay)
    .map(([date, channels]) => ({
      date,
      total: Object.values(channels).reduce((s, v) => s + v, 0),
      byChannel: channels,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    data,
    metadata: {
      totalLeads: clients.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
