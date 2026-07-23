import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide } from "@/lib/report-helpers"

const MARKETING_CATEGORY_NAME = "Маркетинг и реклама"
const NO_CHANNEL = "__none__"

/** 3.x. Эффективность рекламы (ROMI) — по каналам привлечения за месяц.
 *
 *  ROMI = (Выручка − Бюджет) / Бюджет × 100% (только по платным каналам, бюджет > 0).
 *
 *  Столбцы:
 *   - Бюджет  = Σ расходов категории «Маркетинг и реклама» по каналу (Expense.leadChannelId) за месяц.
 *   - Лид     = новые лиды канала (Client.becameLeadAt в месяце) — как в «Лиды по каналам».
 *   - Клиентов= новые клиенты канала: прошли воронку (becameLeadAt≠null) и впервые оплатили
 *              (firstPaymentDate) в месяце — как «продажа» в «Лиды по менеджерам» (баг #53).
 *   - Выручка = Σ стоимости абонементов (finalAmount, createdAt в месяце) этих новых клиентов.
 *   - Ст. лида=Бюджет/Лид, Ст. клиента=Бюджет/Клиентов, Конверсия=Клиентов/Лид.
 *   - Ср. чек = средняя стоимость абонемента (finalAmount) за ПРОШЛЫЙ месяц, общий по центру.
 *  ИТОГО: общий ROMI считается от ВСЕЙ выручки всех каналов (вкл. органику) / весь бюджет. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  // Справочник каналов (вкл. неактивные — чтобы имена резолвились)
  const channels = await db.leadChannel.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })
  const channelName = new Map(channels.map((c) => [c.id, c.name]))

  // Бюджет — расходы категории «Маркетинг и реклама» за месяц (leadChannelId проставляется
  // только у этой категории). Учитываем и категорию организации, и системную.
  const marketingCats = await db.expenseCategory.findMany({
    where: { name: MARKETING_CATEGORY_NAME, OR: [{ tenantId }, { tenantId: null }] },
    select: { id: true },
  })
  const catIds = marketingCats.map((c) => c.id)
  const expenses = catIds.length
    ? await db.expense.findMany({
        where: {
          tenantId,
          deletedAt: null,
          categoryId: { in: catIds },
          date: { gte: dateFrom, lte: dateTo },
        },
        select: { amount: true, leadChannelId: true },
      })
    : []

  // Лиды — контакты, ставшие лидом в месяце (becameLeadAt), по каналу
  const leadClients = await db.client.findMany({
    where: { tenantId, deletedAt: null, becameLeadAt: { gte: dateFrom, lte: dateTo } },
    select: { channelId: true },
  })

  // Новые клиенты — прошли воронку и впервые оплатили в месяце
  const newClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      becameLeadAt: { not: null },
      firstPaymentDate: { gte: dateFrom, lte: dateTo },
    },
    select: { id: true, channelId: true },
  })
  const newClientChannel = new Map(newClients.map((c) => [c.id, c.channelId || NO_CHANNEL]))

  // Выручка — Σ стоимости абонементов (finalAmount), купленных в месяце новыми клиентами
  const subs = newClients.length
    ? await db.subscription.findMany({
        where: {
          tenantId,
          deletedAt: null,
          clientId: { in: newClients.map((c) => c.id) },
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        select: { clientId: true, finalAmount: true },
      })
    : []

  // Агрегация по каналам
  type Acc = { budget: number; leads: number; clients: number; revenue: number }
  const acc = new Map<string, Acc>()
  const ensure = (ch: string): Acc => {
    let a = acc.get(ch)
    if (!a) {
      a = { budget: 0, leads: 0, clients: 0, revenue: 0 }
      acc.set(ch, a)
    }
    return a
  }
  for (const e of expenses) ensure(e.leadChannelId || NO_CHANNEL).budget += Number(e.amount)
  for (const c of leadClients) ensure(c.channelId || NO_CHANNEL).leads += 1
  for (const c of newClients) ensure(c.channelId || NO_CHANNEL).clients += 1
  for (const s of subs) ensure(newClientChannel.get(s.clientId) || NO_CHANNEL).revenue += Number(s.finalAmount)

  // Средний чек — средняя стоимость абонемента за ПРОШЛЫЙ месяц, общий по центру
  const y = dateFrom.getUTCFullYear()
  const m = dateFrom.getUTCMonth()
  const prevFrom = new Date(Date.UTC(y, m - 1, 1))
  const prevTo = new Date(Date.UTC(y, m, 0, 23, 59, 59))
  const prevSubs = await db.subscription.findMany({
    where: { tenantId, deletedAt: null, createdAt: { gte: prevFrom, lte: prevTo } },
    select: { finalAmount: true },
  })
  const avgCheck = safeDivide(
    prevSubs.reduce((s, x) => s + Number(x.finalAmount), 0),
    prevSubs.length,
  )

  const data = [...acc.entries()]
    .map(([channelId, a]) => ({
      channelId,
      channel: channelId === NO_CHANNEL ? "Без канала" : channelName.get(channelId) || "—",
      budget: a.budget,
      leads: a.leads,
      clients: a.clients,
      revenue: a.revenue,
      costPerLead: safeDivide(a.budget, a.leads),
      costPerClient: safeDivide(a.budget, a.clients),
      conversion: safeDivide(a.clients, a.leads),
      // ROMI — только по платным каналам (бюджет > 0); у органических — null («—»)
      romi: a.budget > 0 ? ((a.revenue - a.budget) / a.budget) * 100 : null,
    }))
    .sort((x, z) => z.revenue - x.revenue || z.budget - x.budget)

  const totals = data.reduce(
    (t, r) => {
      t.budget += r.budget
      t.leads += r.leads
      t.clients += r.clients
      t.revenue += r.revenue
      return t
    },
    { budget: 0, leads: 0, clients: 0, revenue: 0 },
  )

  return NextResponse.json({
    data,
    metadata: {
      avgCheck,
      totals: {
        ...totals,
        costPerLead: safeDivide(totals.budget, totals.leads),
        costPerClient: safeDivide(totals.budget, totals.clients),
        conversion: safeDivide(totals.clients, totals.leads),
        // Общий ROMI — вся выручка всех каналов (вкл. органику) / весь бюджет
        romi: totals.budget > 0 ? ((totals.revenue - totals.budget) / totals.budget) * 100 : null,
      },
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
