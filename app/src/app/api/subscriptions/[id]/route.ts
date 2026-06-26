import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import {
  recalcClientDiscounts,
  repriceSubscription,
  type RecalcDiscountsResult,
} from "@/lib/discounts/recalc-client-discounts"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { getLastPaidLessonDate, nextDayUtc, validateWithdrawalDate } from "@/lib/subscriptions/last-paid-lesson-date"
import { churnClientIfNoActiveSubscription } from "@/lib/clients/churn-on-withdrawal"

const updateSchema = z.object({
  status: z.enum(["pending", "active", "closed", "withdrawn"]).optional(),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной").optional(),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие").optional(),
  // Баг #72: было `: null` — undefined превращался в null и затирал wardId
  // при ЛЮБОМ PATCH без него (withdrawn, closed, edit). Теперь корректно: при
  // отсутствии в payload поле не трогаем.
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  withdrawalDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  withdrawalReasonId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  // Комментарий при отчислении — сохраняется в историю коммуникаций клиента (заметка).
  withdrawalComment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Продление срока пакетного абонемента (ISO-дата) — только для type='package'.
  expiresAt: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const subscription = await db.subscription.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      payments: { where: { deletedAt: null }, orderBy: { date: "desc" } },
      discounts: true,
    },
  })

  if (!subscription) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  return NextResponse.json(subscription)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Дата отчисления = последнее платное занятие (правило заказчика). Считаем ДО
  // транзакции, чтобы отдать чистый 400 — throw внутри $transaction не ловится.
  let effectiveWithdrawalDate: Date | null = null

  // Переход в withdrawn требует причины из справочника и даты отчисления.
  // Проверка до транзакции — отдаём 400, если поле пустое или причина не найдена/неактивна.
  if (data.status === "withdrawn") {
    if (!data.withdrawalReasonId) {
      return NextResponse.json(
        { error: "Укажите причину отчисления" },
        { status: 400 },
      )
    }
    const reason = await db.withdrawalReason.findFirst({
      where: {
        id: data.withdrawalReasonId,
        tenantId: session.user.tenantId,
        isActive: true,
      },
      select: { id: true },
    })
    if (!reason) {
      return NextResponse.json(
        { error: "Причина отчисления не найдена" },
        { status: 400 },
      )
    }

    // Дата: явно переданная (оператор поправил в диалоге) ИЛИ последнее платное
    // занятие абонемента. Если нет ни того, ни другого — у абонемента нет платных
    // посещений: запрещаем авто-отчисление и просим указать дату вручную.
    if (data.withdrawalDate) {
      const override = new Date(data.withdrawalDate)
      const sub = await db.subscription.findFirst({
        where: { id, tenantId: session.user.tenantId, deletedAt: null },
        select: { startDate: true },
      })
      if (!sub) {
        return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
      }
      const dateError = validateWithdrawalDate(override, sub.startDate, new Date())
      if (dateError) {
        return NextResponse.json({ error: dateError }, { status: 400 })
      }
      effectiveWithdrawalDate = override
    } else {
      effectiveWithdrawalDate = await getLastPaidLessonDate(db, session.user.tenantId, id)
      if (!effectiveWithdrawalDate) {
        return NextResponse.json(
          {
            error:
              "У абонемента нет платных посещений — отчислить автоматически нельзя. Укажите дату отчисления вручную.",
            code: "NO_PAID_ATTENDANCE",
          },
          { status: 400 },
        )
      }
    }
  }

  // Транзакция: findFirst + update атомарно (M-5 audit fix)
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: { id, tenantId: session.user.tenantId, deletedAt: null },
    })
    if (!existing) return null

    // Пересчёт сумм при изменении цены/кол-ва занятий.
    const lessonPrice = data.lessonPrice ?? Number(existing.lessonPrice)
    const totalLessons = data.totalLessons ?? existing.totalLessons
    const totalAmount = lessonPrice * totalLessons
    const priceChanged = data.lessonPrice !== undefined || data.totalLessons !== undefined

    const updateData: any = {
      lessonPrice,
      totalLessons,
      totalAmount,
    }

    // Скидки v2: для legacy-абонементов (замороженная скидка старой логики)
    // сохраняем старую формулу. Остальным finalAmount/balance пересчитает
    // repriceSubscription после update (снимок списаний + остаток × эфф. цена).
    if (priceChanged && existing.discountSource === "legacy") {
      const discountAmount = Number(existing.discountAmount)
      const finalAmount = totalAmount - discountAmount
      const paidSum = await tx.payment.aggregate({
        where: { subscriptionId: id, deletedAt: null },
        _sum: { amount: true },
      })
      updateData.finalAmount = finalAmount
      updateData.balance = finalAmount - Number(paidSum._sum.amount || 0)
    }

    // «Отчислить» = withdrawn → дополнительно:
    //   1) посчитать дельту баланса (paidToSub − usedAmount): + кредит на
    //      следующий абонемент, − долг (если ходил, не оплатив),
    //   2) деактивировать GroupEnrollment (ребёнок уходит из группы и расписания),
    //   3) обнулить subscription.balance.
    let balanceDelta = 0
    if (data.status === "withdrawn" && existing.status !== "withdrawn") {
      // Нетто-оплачено (transfer_in минус унесённое возвратом/переносом) —
      // иначе уже унесённые деньги вернулись бы на баланс второй раз (Баг #4).
      const paidToSub = await netPaidToSubscription(tx, session.user.tenantId, id)
      const usedAgg = await tx.attendance.aggregate({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
        },
        _sum: { chargeAmount: true },
      })
      const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
      // Минус уже применённые сверки прошлых закрытий (знаковая сумма):
      // отчисление ранее закрытого/реактивированного не двигает баланс дважды.
      const priorAgg = await tx.clientBalanceTransaction.aggregate({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
          type: "subscription_closed_refund",
        },
        _sum: { amount: true },
      })
      const delta = paidToSub
        .minus(usedAmount)
        .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))
      balanceDelta = delta.toNumber()

      if (!delta.isZero()) {
        await applyBalanceDelta(tx, {
          tenantId: session.user.tenantId,
          clientId: existing.clientId,
          delta,
          type: "subscription_closed_refund",
          refs: { subscriptionId: id, directionId: existing.directionId },
          comment: delta.isPositive()
            ? `Отчисление: возврат на баланс ${delta.toFixed(2)} ₽`
            : `Отчисление: долг ${delta.abs().toFixed(2)} ₽`,
          createdBy: session.user.employeeId,
        })
      }
      updateData.balance = 0

      // Ребёнок уходит из группы → исчезает из расписания (Lessons остаются
      // объектами, но без зачисления = без посещения). НО только если у него не
      // осталось другого живого (pending/active) абонемента в этой же группе:
      // календарный тип создаёт новый абонемент каждый месяц при одном общем
      // GroupEnrollment, поэтому отчисление одного месяца не должно выкидывать
      // ребёнка с оплаченным другим месяцем той же группы.
      // withdrawnAt = дата отчисления + 1 день: ученик остаётся в составе на
      // последнем платном занятии (D), но выпадает из всех более поздних
      // (фильтр состава — withdrawnAt > дата занятия).
      await deactivateGroupEnrollmentOnWithdrawal(tx, {
        tenantId: session.user.tenantId,
        groupId: existing.groupId,
        clientId: existing.clientId,
        wardId: existing.wardId,
        excludeSubscriptionId: id,
        withdrawnAt: effectiveWithdrawalDate
          ? nextDayUtc(effectiveWithdrawalDate)
          : undefined,
      })
    }

    // «Закрыть» = closed → штатное завершение, период истёк, занятия отработаны:
    //   1) посчитать дельту (paidToSub − usedAmount): переплата → +balance клиента,
    //      долг → −balance (клиент попадёт в должников),
    //   2) НЕ деактивировать GroupEnrollment (ребёнок остаётся в группе — он
    //      просто покупает следующий абонемент),
    //   3) обнулить subscription.balance, проставить endDate = последний день периода.
    if (data.status === "closed" && existing.status !== "closed" && existing.status !== "withdrawn") {
      // Нетто-оплачено и вычет прошлых сверок — см. ветку withdrawn выше.
      const paidToSub = await netPaidToSubscription(tx, session.user.tenantId, id)
      const usedAgg = await tx.attendance.aggregate({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
        },
        _sum: { chargeAmount: true },
      })
      const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
      const priorAgg = await tx.clientBalanceTransaction.aggregate({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
          type: "subscription_closed_refund",
        },
        _sum: { amount: true },
      })
      const delta = paidToSub
        .minus(usedAmount)
        .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))
      balanceDelta = delta.toNumber()

      if (!delta.isZero()) {
        await applyBalanceDelta(tx, {
          tenantId: session.user.tenantId,
          clientId: existing.clientId,
          delta,
          type: "subscription_closed_refund",
          refs: { subscriptionId: id, directionId: existing.directionId },
          comment: delta.isPositive()
            ? `Закрытие: возврат на баланс ${delta.toFixed(2)} ₽`
            : `Закрытие: долг ${delta.abs().toFixed(2)} ₽`,
          createdBy: session.user.employeeId,
        })
      }
      updateData.balance = 0
      // endDate = последний день периода (для package — сегодня).
      if (existing.periodYear && existing.periodMonth) {
        updateData.endDate = new Date(Date.UTC(existing.periodYear, existing.periodMonth, 0))
      } else {
        updateData.endDate = new Date()
      }
    }

    if (data.status) {
      updateData.status = data.status
      if (data.status === "active" && !existing.activatedAt) {
        updateData.activatedAt = new Date()
      }
      if (data.status === "withdrawn") {
        // effectiveWithdrawalDate вычислен до транзакции: переданная дата ИЛИ
        // дата последнего платного занятия.
        updateData.withdrawalDate = effectiveWithdrawalDate
        updateData.withdrawalReasonId = data.withdrawalReasonId
      }
    }

    if (data.wardId !== undefined) {
      updateData.wardId = data.wardId
    }

    // Продление срока пакета — только для type='package'.
    if (data.expiresAt !== undefined) {
      if (existing.type !== "package") {
        throw new Error("expiresAt доступно только для пакетного типа")
      }
      const parsed = new Date(data.expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Некорректная дата expiresAt")
      }
      updateData.expiresAt = parsed
      // Если пакет был закрыт по истечении, и его продлили в будущее — реактивируем.
      if (existing.status === "closed" && parsed > new Date()) {
        updateData.status = "active"
        updateData.endDate = null
      }
    }

    const subscription = await tx.subscription.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        direction: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    })

    // Отчисление последнего активного абонемента → клиент «Выбывший».
    // ПОСЛЕ update: текущий абонемент уже withdrawn и не попадёт в счётчик
    // активных. effectiveWithdrawalDate при withdrawn гарантированно задан
    // (валидируется до транзакции), фоллбэк на now — на всякий случай.
    if (data.status === "withdrawn" && existing.status !== "withdrawn") {
      await churnClientIfNoActiveSubscription(
        tx,
        session.user.tenantId,
        existing.clientId,
        effectiveWithdrawalDate ?? new Date(),
      )
    }

    // Комментарий к отчислению → заметка в историю коммуникаций клиента (виден
    // в ленте/фиде карточки родителя). Только при переходе в withdrawn и если
    // комментарий заполнен. Контекст (направление + период) — чтобы заметка
    // была самодостаточной в общем фиде коммуникаций.
    if (
      data.status === "withdrawn" &&
      existing.status !== "withdrawn" &&
      data.withdrawalComment
    ) {
      const period =
        existing.periodMonth && existing.periodYear
          ? `${String(existing.periodMonth).padStart(2, "0")}.${existing.periodYear}`
          : null
      await tx.communication.create({
        data: {
          tenantId: session.user.tenantId,
          clientId: existing.clientId,
          type: "note",
          channel: "internal",
          direction: "internal",
          content:
            `Отчисление абонемента «${subscription.direction.name}»` +
            `${period ? ` (${period})` : ""}. ${data.withdrawalComment}`,
          employeeId: session.user.employeeId || undefined,
        },
      })
    }

    // Скидки v2: пересчёт денег абонемента после правки цены/занятий
    // (не для legacy и не для только что закрытых/отчисленных — у них
    // balance уже выставлен закрытием).
    if (
      priceChanged &&
      existing.discountSource !== "legacy" &&
      data.status !== "withdrawn" &&
      data.status !== "closed"
    ) {
      await repriceSubscription(tx, {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        createdBy: session.user.employeeId ?? null,
      })
    }

    // Скидки v2: изменение состава месяца (отчисление/аннулирование) или цены
    // (мог смениться «самый дорогой») — пересчёт скидок клиента.
    let discountRecalc: RecalcDiscountsResult = { changes: [] }
    if (priceChanged || data.status === "withdrawn" || data.status === "closed") {
      discountRecalc = await recalcClientDiscounts(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        createdBy: session.user.employeeId ?? null,
      })
    }

    return { subscription, discountRecalc, balanceDelta }
  })

  if (!result) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  const response: any = { ...result.subscription }
  const removed = result.discountRecalc.changes.filter((c) => c.action === "removed")
  const refundedTotal = result.discountRecalc.changes.reduce(
    (s, c) => s + c.refundedToBalance,
    0,
  )
  if (removed.length > 0) {
    response._templateDiscountWarning = {
      message:
        `Автоскидка снята с ${removed.length} абонемент(ов): состав абонементов месяца изменился.` +
        (refundedTotal > 0
          ? ` Возвращено на баланс родителя: ${refundedTotal.toLocaleString("ru-RU")} ₽.`
          : ""),
      affected: removed,
    }
  } else if (refundedTotal > 0) {
    response._templateDiscountWarning = {
      message: `Пересчёт скидок: возвращено на баланс родителя ${refundedTotal.toLocaleString("ru-RU")} ₽.`,
      affected: result.discountRecalc.changes,
    }
  }
  if (result.balanceDelta !== 0) {
    response._balanceDelta = result.balanceDelta
  }

  return NextResponse.json(response)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  // Транзакция: findFirst + update атомарно (M-5 audit fix)
  const deleted = await db.$transaction(async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: { id, tenantId: session.user.tenantId, deletedAt: null },
    })
    if (!existing) return null

    // Скидки v2 §11.1: удалять можно только абонементы без денег и без
    // посещений — иначе оплаченное/отхоженное «повисает в воздухе».
    // Отметки считаем по числу (бесплатные занятия при 100% скидке тоже).
    const [paymentsCount, attendedCount] = await Promise.all([
      tx.payment.count({
        where: { tenantId: session.user.tenantId, subscriptionId: id, deletedAt: null },
      }),
      tx.attendance.count({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
          isPending: false,
          attendanceType: { chargesSubscription: true },
        },
      }),
    ])
    if (paymentsCount > 0 || attendedCount > 0 || Number(existing.chargedAmount) > 0) {
      return {
        error:
          "Нельзя удалить абонемент с оплатами или списаниями за занятия. " +
          "Используйте «Отчислить» — деньги будут пересчитаны и возвращены на баланс.",
      }
    }

    await tx.subscription.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    // Скидки v2: удалённый выпадает из состава месяца — пересчёт остальных.
    await recalcClientDiscounts(tx, {
      tenantId: session.user.tenantId,
      clientId: existing.clientId,
      createdBy: session.user.employeeId ?? null,
    })
    return { ok: true as const }
  })

  if (!deleted) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  if ("error" in deleted) return NextResponse.json({ error: deleted.error }, { status: 422 })

  return NextResponse.json({ ok: true })
}
