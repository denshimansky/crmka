import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.6. Лиды по менеджерам */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Get all admins/managers
  const employees = await db.employee.findMany({
    where: {
      tenantId,
      deletedAt: null,
      role: { in: ["admin", "manager", "owner"] },
    },
    select: { id: true, firstName: true, lastName: true },
  })

  const empMap = new Map(employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ")]))

  // Clients created in period.
  // Массовый импорт (source=import) исключаем — его createdAt = дата импорта,
  // иначе вся залитая база падает «новыми лидами» на одного менеджера-импортёра.
  const clientWhere: any = {
    tenantId,
    deletedAt: null,
    source: { not: "import" },
    createdAt: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) clientWhere.branchId = branchId

  const clients = await db.client.findMany({
    where: clientWhere,
    select: { id: true, createdBy: true, createdAt: true },
  })

  // Subscriptions created in period
  const subs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    select: { clientId: true, createdBy: true, createdAt: true },
  })

  // Trials scheduled in period
  const trials = await db.trialLesson.findMany({
    where: {
      tenantId,
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    select: { clientId: true, createdBy: true, createdAt: true, status: true },
  })

  // Aggregate by manager
  const managerStats = new Map<
    string,
    {
      name: string
      leadsCreated: number
      subsCreated: number
      trialsScheduled: number
      trialsAttended: number
      sales: number
    }
  >()

  const getOrCreate = (empId: string) => {
    if (!managerStats.has(empId)) {
      managerStats.set(empId, {
        name: empMap.get(empId) || "Неизвестный",
        leadsCreated: 0,
        subsCreated: 0,
        trialsScheduled: 0,
        trialsAttended: 0,
        sales: 0,
      })
    }
    return managerStats.get(empId)!
  }

  for (const c of clients) {
    if (c.createdBy) getOrCreate(c.createdBy).leadsCreated += 1
  }

  for (const s of subs) {
    if (s.createdBy) getOrCreate(s.createdBy).subsCreated += 1
  }

  for (const t of trials) {
    if (t.createdBy) {
      getOrCreate(t.createdBy).trialsScheduled += 1
      if (t.status === "attended") getOrCreate(t.createdBy).trialsAttended += 1
    }
  }

  // Продажи = клиенты с первой оплатой (firstPaymentDate) в периоде. Атрибутируем
  // НЕ создателю лида (client.createdBy — у импортной/старой базы это часто
  // владелец-импортёр), а тому, кто реально провёл продажу: создателю ПЕРВОГО
  // платежа клиента (Payment.createdBy). Баг #23 — проверено данными msk1 (июнь
  // 2026): по client.createdBy 32 продажи падали на владельца, по создателю
  // первого платежа — 34 на менеджера, который оформлял оплаты.
  const salesClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      firstPaymentDate: { gte: dateFrom, lte: dateTo },
    },
    select: { id: true },
  })
  const salesClientIds = salesClients.map((c) => c.id)
  if (salesClientIds.length > 0) {
    const payments = await db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: "incoming",
        clientId: { in: salesClientIds },
        createdBy: { not: null },
      },
      select: { clientId: true, createdBy: true, isFirstPayment: true, date: true, createdAt: true },
    })
    // Первый платёж клиента: помеченный isFirstPayment, иначе самый ранний по дате.
    const firstPay = new Map<string, { isFirst: boolean; date: number; createdAt: number; by: string }>()
    for (const p of payments) {
      if (!p.clientId || !p.createdBy) continue
      const cand = {
        isFirst: p.isFirstPayment,
        date: new Date(p.date).getTime(),
        createdAt: new Date(p.createdAt).getTime(),
        by: p.createdBy,
      }
      const cur = firstPay.get(p.clientId)
      const wins =
        !cur ||
        (cand.isFirst !== cur.isFirst
          ? cand.isFirst
          : cand.date !== cur.date
            ? cand.date < cur.date
            : cand.createdAt < cur.createdAt)
      if (wins) firstPay.set(p.clientId, cand)
    }
    for (const { by } of firstPay.values()) getOrCreate(by).sales += 1
  }

  const data = [...managerStats.entries()]
    .map(([id, v]) => ({ managerId: id, ...v }))
    .sort((a, b) => b.sales - a.sales)

  return NextResponse.json({
    data,
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
