import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reactivateChurnedClient } from "@/lib/clients/reactivate-churned"
import { churnClientIfNoActiveSubscription } from "@/lib/clients/churn-on-withdrawal"
import { latestDate } from "@/lib/clients/active-engagement"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/check-inactive-clients
//
// Раз в сутки (GitHub Actions cron) находит активных клиентов всех тенантов,
// у которых нет активной платной активности уже 30+ дней, и переводит в
// clientStatus=churned.
//
// «Платная активность» = активный абонемент ИЛИ платное занятие (chargeAmount>0) —
// те же события, что делают лида клиентом (симметрия с конверсией). «30 дней»
// отсчитываем от последнего платного события: max(withdrawalDate, endDate,
// startDate) по абонементам И даты последнего платного занятия. Если оно было
// >= 30 дней назад и сейчас нет активного абонемента — клиент уходит в «Выбывшие».
// Клиента без единого платного события (импортная база «активных» без
// абонементов/занятий) крон НЕ трогает.
//
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Обратная сторона инварианта (Баг #5): «Выбывший» с активным абонементом —
  // всегда рассинхрон. Вручную так сделать нельзя (PATCH клиента запрещает
  // churned при активных абонементах); возникает, когда клиента выбыли при
  // pending-абонементах, а повторная оплата/активация не возвращала статус.
  // Возвращаем таких в активные.
  const toReactivate = await db.client.findMany({
    where: {
      deletedAt: null,
      clientStatus: "churned",
      subscriptions: { some: { status: "active", deletedAt: null } },
    },
    select: { id: true, tenantId: true },
  })
  let reactivatedCount = 0
  for (const c of toReactivate) {
    // Через хелпер — пишет событие в историю карточки (автор «Система»).
    if (await reactivateChurnedClient(db, c.tenantId, c.id, { reason: "cron_reactivated" })) {
      reactivatedCount++
    }
  }

  const thresholdDays = 30
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - thresholdDays)

  // Кандидаты: активные клиенты без активных абонементов.
  // Архив/ЧС/уже churned не трогаем.
  const candidates = await db.client.findMany({
    where: {
      deletedAt: null,
      clientStatus: "active",
      subscriptions: { none: { status: "active", deletedAt: null } },
    },
    select: {
      id: true,
      tenantId: true,
      subscriptions: {
        where: { deletedAt: null },
        orderBy: { startDate: "desc" },
        take: 5,
        select: {
          startDate: true,
          endDate: true,
          withdrawalDate: true,
        },
      },
    },
  })

  // Последнее платное занятие (chargeAmount>0) по каждому кандидату — одним
  // запросом. Клиент, ставший активным разовым ПЛАТНЫМ ЗАНЯТИЕМ без абонемента,
  // теперь тоже корректно уходит в отток через 30 дней с последнего платного
  // события (раньше крон смотрел только на абонементы и таких клиентов не трогал —
  // асимметрия с конверсией, где актив дают и оплата, и платное занятие).
  const candidateIds = candidates.map((c) => c.id)
  const paidRows = candidateIds.length
    ? await db.$queryRaw<{ client_id: string; last_paid: Date | null }[]>`
        SELECT a.client_id::text AS client_id, MAX(l.date) AS last_paid
        FROM attendances a
        JOIN lessons l ON l.id = a.lesson_id
        WHERE a.client_id = ANY(${candidateIds}::uuid[]) AND a.charge_amount > 0
        GROUP BY a.client_id
      `
    : []
  const lastPaidByClient = new Map(
    paidRows.map((r) => [r.client_id, r.last_paid ? new Date(r.last_paid) : null]),
  )

  const toChurn: string[] = []
  for (const c of candidates) {
    // Последнее платное событие = позднейшая из дат абонементов (выбытие/конец/
    // старт) и даты последнего платного занятия. null → у клиента вообще не было
    // платной активности (импортная база «активных» без абонементов/занятий) —
    // такого не трогаем, как и раньше.
    const subLastDate = latestDate(
      c.subscriptions.flatMap((s) => [s.withdrawalDate, s.endDate, s.startDate]),
    )
    const lastActivity = latestDate([subLastDate, lastPaidByClient.get(c.id) ?? null])
    if (!lastActivity) continue
    if (lastActivity <= threshold) toChurn.push(c.id)
  }

  if (toChurn.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: candidates.length,
      churned: 0,
      reactivated: reactivatedCount,
    })
  }

  // Через хелпер по каждому — заодно пишет событие в историю карточки (автор
  // «Система», причина «неактивность»).
  const tenantByClient = new Map(candidates.map((c) => [c.id, c.tenantId]))
  const churnDate = new Date()
  let churnedCount = 0
  for (const id of toChurn) {
    const tenantId = tenantByClient.get(id)
    if (!tenantId) continue
    if (await churnClientIfNoActiveSubscription(db, tenantId, id, churnDate, { reason: "cron_inactive" })) {
      churnedCount++
    }
  }

  return NextResponse.json({
    ok: true,
    checked: candidates.length,
    churned: churnedCount,
    reactivated: reactivatedCount,
    thresholdDays,
  })
}
