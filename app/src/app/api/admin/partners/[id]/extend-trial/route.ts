import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { cancelInvoice } from "@/lib/billing/apply-invoice-payment"
import { toUtcDate, anchorDayFromTrialEnd } from "@/lib/billing/billing-schedule"
import { z } from "zod"

// POST /api/admin/partners/[id]/extend-trial — продлить тестовый период партнёра.
//
// Двигаем конец теста на новую дату. Так как день-якорь и срок первой оплаты
// выводятся из конца теста, пересчитываем и их (billingAnchorDay, nextPaymentDate).
// Неоплаченный триальный счёт (если крон уже успел выставить его за 2 дня до
// прежнего конца) отменяется — крон перевыставит новый за 2 дня до новой даты.
// Партнёр остаётся/возвращается в тест: снимаем возможную блокировку.
//
// Доступно superadmin/billing. Только пока подписка в статусе trial — после
// оплаты триального счёта партнёр конвертируется (status != trial) и продление
// теста уже неприменимо.
const schema = z.object({
  trialEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const newTrialEnd = new Date(parsed.data.trialEndsAt + "T00:00:00.000Z")
  if (isNaN(newTrialEnd.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
  }

  const today = toUtcDate(new Date())
  if (newTrialEnd.getTime() <= today.getTime()) {
    return NextResponse.json({ error: "Новая дата конца теста должна быть в будущем" }, { status: 400 })
  }

  // Последняя не отменённая подписка партнёра.
  const sub = await db.billingSubscription.findFirst({
    where: { organizationId: id, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
  })
  if (!sub) return NextResponse.json({ error: "У партнёра нет активной подписки" }, { status: 404 })

  // Продлевать можно только НЕ конвертированный тест. «Конвертирован» = есть
  // оплаченный счёт (оплата уводит подписку из теста). Просроченный неоплаченный
  // тест (grace_period/blocked, счёт overdue) продлевать МОЖНО — это основной
  // сценарий: партнёр не успел оплатить, ему дают ещё времени. Поэтому гейтим
  // по факту оплаты, а НЕ по статусу подписки.
  if (sub.trialEndsAt == null) {
    return NextResponse.json(
      { error: "У партнёра нет тестового периода (подписка не триальная)" },
      { status: 400 },
    )
  }
  const paidCount = await db.billingInvoice.count({
    where: { subscriptionId: sub.id, status: "paid" },
  })
  if (paidCount > 0) {
    return NextResponse.json(
      { error: "Партнёр уже оплатил счёт — тест продлевать нельзя (партнёр конвертирован)" },
      { status: 400 },
    )
  }

  const oldTrialEnd = toUtcDate(sub.trialEndsAt)
  if (newTrialEnd.getTime() <= oldTrialEnd.getTime()) {
    return NextResponse.json(
      { error: "Новая дата должна быть позже текущего конца теста — тест можно только продлить, не сократить" },
      { status: 400 },
    )
  }

  const newAnchor = anchorDayFromTrialEnd(newTrialEnd)

  await db.$transaction(async (tx) => {
    // Неоплаченный триальный счёт (periodStart = прежний срок = прежний конец теста)
    // отменяем: cancelInvoice вернёт учтённый кредит и уберёт уведомление; крон
    // перевыставит новый счёт за 2 дня до новой даты.
    const trialInvoice = await tx.billingInvoice.findFirst({
      where: {
        subscriptionId: sub.id,
        periodStart: sub.nextPaymentDate,
        status: { in: ["pending", "overdue"] },
      },
      select: { id: true },
    })
    if (trialInvoice) {
      await cancelInvoice(tx, trialInvoice.id)
    }

    // Двигаем конец теста + производные (якорь, срок первой оплаты). Возвращаем
    // подписку в trial и снимаем возможную блокировку/грейс — тест продлён.
    await tx.billingSubscription.update({
      where: { id: sub.id },
      data: {
        trialEndsAt: newTrialEnd,
        billingAnchorDay: newAnchor,
        nextPaymentDate: newTrialEnd,
        status: "trial",
        blockedAt: null,
        gracePeriodEnd: null,
      },
    })

    // Организация — снова активна (если была заблокирована/в грейсе из-за теста).
    await tx.organization.update({
      where: { id },
      data: { billingStatus: "active" },
    })
  })

  return NextResponse.json({ ok: true, trialEndsAt: newTrialEnd.toISOString().slice(0, 10) })
}
