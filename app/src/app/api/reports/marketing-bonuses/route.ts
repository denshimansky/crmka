import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.7. Разовые скидки — начисленные бонусы (BonusDiscount) на баланс клиентов за месяц. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  const items = await db.bonusDiscount.findMany({
    where: { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      responsible: { select: { firstName: true, lastName: true } },
      channel: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  })

  const data = items.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    clientId: r.client.id,
    clientName: [r.client.lastName, r.client.firstName].filter(Boolean).join(" ") || "Без имени",
    reason: r.reason,
    isMarketing: r.isMarketing,
    channelName: r.channel?.name ?? null,
    responsibleName: r.responsible
      ? [r.responsible.lastName, r.responsible.firstName].filter(Boolean).join(" ")
      : null,
    amount: Number(r.amount),
  }))

  const total = data.reduce((s, r) => s + r.amount, 0)
  const marketing = data.filter((r) => r.isMarketing)
  const marketingTotal = marketing.reduce((s, r) => s + r.amount, 0)

  const byChannelMap = new Map<string, { amount: number; count: number }>()
  for (const r of marketing) {
    const key = r.channelName ?? "(не указан)"
    const prev = byChannelMap.get(key) ?? { amount: 0, count: 0 }
    prev.amount += r.amount
    prev.count += 1
    byChannelMap.set(key, prev)
  }
  const byChannel = [...byChannelMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.amount - a.amount)

  return NextResponse.json({
    data,
    metadata: {
      total,
      count: data.length,
      marketingTotal,
      marketingCount: marketing.length,
      byChannel,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
