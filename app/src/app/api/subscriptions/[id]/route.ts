import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import {
  recalcClientDiscounts,
  repriceSubscription,
  setSubscriptionManualDiscount,
  type RecalcDiscountsResult,
} from "@/lib/discounts/recalc-client-discounts"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { ensureEnrollmentForSubscription } from "@/lib/subscriptions/ensure-enrollment"
import { resolveAwaitingApplicationOnSubscriptionEnd } from "@/lib/subscriptions/resolve-awaiting-application"
import { prorateScheduledWithdrawal } from "@/lib/subscriptions/prorate-scheduled-withdrawal"
import { resolveWithdrawalDate } from "@/lib/subscriptions/last-paid-lesson-date"
import { churnClientIfNoActiveSubscription } from "@/lib/clients/churn-on-withdrawal"
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"
import { closeSubscription } from "@/lib/subscriptions/close-subscription"
import { getWithdrawalBlockReason } from "@/lib/subscriptions/withdrawal-block"
import { currencySymbol } from "@/lib/currency"

const updateSchema = z.object({
  status: z.enum(["pending", "active", "closed", "withdrawn"]).optional(),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной").optional(),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие").optional(),
  // Скидки v3: смена ручной скидки. undefined — поле не прислано (не трогаем);
  // строка-id — выбрать шаблон; null/""/"none" — снять ручную скидку.
  discountTemplateId: z.any().transform(v => {
    if (v === undefined) return undefined
    return (typeof v === "string" && v.trim() && v.trim() !== "none") ? v.trim() : null
  }),
  // Баг #72: было `: null` — undefined превращался в null и затирал wardId
  // при ЛЮБОМ PATCH без него (withdrawn, closed, edit). Теперь корректно: при
  // отсутствии в payload поле не трогаем.
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Дата отчисления больше не принимается от клиента — вычисляется автоматически
  // (последнее платное занятие, иначе дата создания). См. resolveWithdrawalDate.
  withdrawalReasonId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  // Комментарий при отчислении — сохраняется в историю коммуникаций клиента (заметка).
  withdrawalComment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Отмена запланированного (отложенного) отчисления — снять scheduledWithdrawal*.
  cancelScheduledWithdrawal: z.any().transform(v => v === true),
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

  const currency =
    (
      await db.organization.findUnique({
        where: { id: session.user.tenantId },
        select: { currency: true },
      })
    )?.currency ?? "RUB"
  const sym = currencySymbol(currency)

  // Отмена отложенного отчисления (Подход A): снять scheduledWithdrawal*, вернуть
  // ребёнка в состав группы. Отдельный ранний путь — не трогает основную логику.
  if (data.cancelScheduledWithdrawal) {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { id, tenantId: session.user.tenantId, deletedAt: null },
        include: { direction: { select: { name: true } } },
      })
      if (!existing) return null
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          scheduledWithdrawalDate: null,
          scheduledWithdrawalReasonId: null,
          scheduledWithdrawalComment: null,
        },
      })
      let prorationRestored = false
      if (existing.scheduledWithdrawalDate) {
        // Вернуть зачисление в группе (отменяем выставленный withdrawnAt = X+1).
        await tx.groupEnrollment.updateMany({
          where: {
            tenantId: session.user.tenantId,
            groupId: existing.groupId,
            clientId: existing.clientId,
            wardId: existing.wardId,
            deletedAt: null,
            isActive: false,
          },
          data: { isActive: true, withdrawnAt: null },
        })
        // Вернуть полную стоимость периода (планирование пересчитало «к оплате»
        // на занятия по дату X — теперь ребёнок снова ходит весь месяц).
        const proration = await prorateScheduledWithdrawal(tx, {
          tenantId: session.user.tenantId,
          subscription: existing,
          until: null,
          createdBy: session.user.employeeId ?? null,
        })
        prorationRestored = proration.changed
        if (proration.changed) {
          await recalcClientDiscounts(tx, {
            tenantId: session.user.tenantId,
            clientId: existing.clientId,
            createdBy: session.user.employeeId ?? null,
          })
        }
        await tx.communication.create({
          data: {
            tenantId: session.user.tenantId,
            clientId: existing.clientId,
            type: "note",
            channel: "internal",
            direction: "internal",
            content:
              `Отменено запланированное отчисление абонемента «${existing.direction.name}».` +
              `${proration.changed ? ` Стоимость восстановлена: занятий в периоде — ${proration.totalLessons}.` : ""}`,
            employeeId: session.user.employeeId || undefined,
          },
        })
      }
      const freshSub = prorationRestored
        ? await tx.subscription.findFirst({ where: { id, tenantId: session.user.tenantId } })
        : updated
      return { subscription: freshSub ?? updated }
    })
    if (!result) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
    return NextResponse.json({ ...result.subscription, _scheduledWithdrawalCancelled: true })
  }

  // Дата отчисления вычисляется автоматически (правило заказчика): дата последнего
  // платного занятия абонемента, а если платных занятий не было — дата создания
  // абонемента (такой абонемент в отток не попадает). Ручной ввод даты убран,
  // будущей датой (отложенное отчисление) больше не создаётся. Считаем ДО транзакции.
  let effectiveWithdrawalDate: Date | null = null

  // Переход в withdrawn требует причины из справочника. Проверка до транзакции —
  // отдаём 400, если причина не указана или не найдена/неактивна.
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
    const sub = await db.subscription.findFirst({
      where: { id, tenantId: session.user.tenantId, deletedAt: null },
      select: { createdAt: true },
    })
    if (!sub) {
      return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
    }
    effectiveWithdrawalDate = (
      await resolveWithdrawalDate(db, session.user.tenantId, id, sub.createdAt)
    ).date

    // Блокировка отчисления по статусу занятия (матрица «Виды посещений» →
    // «Разрешить отчисление»): напр. незакрытая «Назначена отработка».
    const blockReason = await getWithdrawalBlockReason(db, session.user.tenantId, id)
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 409 })
    }
  }

  // Штатное закрытие (closed): период истёк, занятия отработаны. Единый хелпер
  // closeSubscription делает денежную сверку (возврат переплаты за прощённые
  // «Уваж. пропуск»/«Перерасчёт»), пишет строку в историю клиента, ставит
  // status/endDate и деактивирует зачисление — тот же путь, что и cron
  // close-finished-calendar-subscriptions. Отдельный ранний путь: закрытие —
  // терминальное действие, с прочими правками PATCH не сочетается (кнопки в UI
  // нет, вызов программный).
  if (data.status === "closed") {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { id, tenantId: session.user.tenantId, deletedAt: null },
        select: { id: true, clientId: true, status: true },
      })
      if (!existing) return { code: 404 as const }
      if (existing.status === "closed" || existing.status === "withdrawn") {
        return { code: 400 as const, error: "Абонемент уже закрыт или отчислен" }
      }
      const closeRes = await closeSubscription(tx, {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        currency,
        employeeId: session.user.employeeId ?? null,
      })
      // Абонемент выпал из активных — состав месяца изменился, пересчёт скидок.
      const discountRecalc = await recalcClientDiscounts(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        createdBy: session.user.employeeId ?? null,
      })
      const subscription = await tx.subscription.findFirst({
        where: { id, tenantId: session.user.tenantId },
        include: {
          client: { select: { id: true, firstName: true, lastName: true } },
          direction: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
        },
      })
      return { subscription, discountRecalc, balanceDelta: closeRes.balanceDelta }
    })
    if ("code" in result) {
      return NextResponse.json(
        { error: result.code === 404 ? "Абонемент не найден" : result.error },
        { status: result.code },
      )
    }
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
            ? ` Возвращено на баланс родителя: ${refundedTotal.toLocaleString("ru-RU")} ${sym}.`
            : ""),
        affected: removed,
      }
    } else if (refundedTotal > 0) {
      response._templateDiscountWarning = {
        message: `Пересчёт скидок: возвращено на баланс родителя ${refundedTotal.toLocaleString("ru-RU")} ${sym}.`,
        affected: result.discountRecalc.changes,
      }
    }
    if (result.balanceDelta !== 0) {
      response._balanceDelta = result.balanceDelta
    }
    return NextResponse.json(response)
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
            ? `Отчисление: возврат на баланс ${delta.toFixed(2)} ${sym}`
            : `Отчисление: долг ${delta.abs().toFixed(2)} ${sym}`,
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
      })

      // Баг #62: заявка «Ожидаем оплату» по этому абонементу не должна зависать
      // в воронке после отчисления (платил → won, не платил → potential).
      await resolveAwaitingApplicationOnSubscriptionEnd(tx, {
        tenantId: session.user.tenantId,
        subscription: {
          id: existing.id,
          clientId: existing.clientId,
          wardId: existing.wardId,
          directionId: existing.directionId,
          status: existing.status,
          activatedAt: existing.activatedAt,
        },
        netPaid: paidToSub,
        employeeId: session.user.employeeId,
      })
    }

    // Закрытие (status=closed) обрабатывается ранним путём выше через
    // closeSubscription — сюда не доходит.

    if (data.status) {
      updateData.status = data.status
      if (data.status === "active" && !existing.activatedAt) {
        updateData.activatedAt = new Date()
      }
      if (data.status === "withdrawn") {
        // effectiveWithdrawalDate вычислен до транзакции: последнее платное занятие,
        // иначе дата создания абонемента (resolveWithdrawalDate).
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
        // Симметрия с деактивацией зачисления при закрытии: вернуть ребёнка в
        // состав группы. startDate = сегодня; хелпер сам различает случаи:
        // пакет закрыт недавно (withdrawnAt свежий) → продолжение, история
        // enrolledAt сохраняется (ребёнок виден в прошлых составах, короткий
        // гэп — приемлемая цена); закрыт давно → возврат, зачисление от
        // сегодня (в занятиях долгого гэпа не всплывает). Для живого — no-op.
        const now = new Date()
        const reEnrollDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        await ensureEnrollmentForSubscription(tx, {
          tenantId: session.user.tenantId,
          groupId: existing.groupId,
          clientId: existing.clientId,
          wardId: existing.wardId,
          startDate: reEnrollDate,
        })
        // ensure ставит вернувшемуся «Ожидаем оплату»; оплаченному пакету
        // бейдж не положен — снимаем по факту денег (зеркалит activateSubscription).
        const paidToPackage = await netPaidToSubscription(tx, session.user.tenantId, id)
        if (paidToPackage.gte(existing.finalAmount)) {
          await tx.groupEnrollment.updateMany({
            where: {
              tenantId: session.user.tenantId,
              groupId: existing.groupId,
              clientId: existing.clientId,
              wardId: existing.wardId,
              isActive: true,
            },
            data: { paymentStatus: "active" },
          })
        }
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
        { employeeId: session.user.employeeId, reason: "withdrawal" },
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

    // Скидки v3: смена ручной скидки (выбран/снят шаблон) — пересчёт денег этого
    // абонемента под новый шаблон (percent считается от текущей цены). Если менялась
    // ТОЛЬКО цена (без смены скидки) — repriceSubscription сохраняет текущую скидку.
    // Не для legacy и не для только что отчисленных (у них balance уже выставлен;
    // закрытие сюда не доходит — обработано ранним путём).
    const discountChanged = data.discountTemplateId !== undefined
    if (
      discountChanged &&
      existing.discountSource !== "legacy" &&
      data.status !== "withdrawn"
    ) {
      await setSubscriptionManualDiscount(tx, {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        templateId: data.discountTemplateId ?? null,
        createdBy: session.user.employeeId ?? null,
      })
    } else if (
      priceChanged &&
      existing.discountSource !== "legacy" &&
      data.status !== "withdrawn"
    ) {
      await repriceSubscription(tx, {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        createdBy: session.user.employeeId ?? null,
      })
    }

    // Изменение состава месяца (отчисление/аннулирование), цены или ручной скидки
    // (мог смениться «самый дорогой» среди кандидатов тип-1) — пересчёт клиента.
    let discountRecalc: RecalcDiscountsResult = { changes: [] }
    if (priceChanged || discountChanged || data.status === "withdrawn") {
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
          ? ` Возвращено на баланс родителя: ${refundedTotal.toLocaleString("ru-RU")} ${sym}.`
          : ""),
      affected: removed,
    }
  } else if (refundedTotal > 0) {
    response._templateDiscountWarning = {
      message: `Пересчёт скидок: возвращено на баланс родителя ${refundedTotal.toLocaleString("ru-RU")} ${sym}.`,
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
    // Отметки считаем по израсходованным слотам: бесплатные занятия при 100%
    // скидке и финальные несписывающие (Уваж. пропуск/Перерасчёт) тоже значат,
    // что абонемент жил — его отчисляют, а не удаляют.
    const [paymentsCount, attendedCount] = await Promise.all([
      tx.payment.count({
        where: { tenantId: session.user.tenantId, subscriptionId: id, deletedAt: null },
      }),
      tx.attendance.count({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
          isPending: false,
          attendanceType: consumedTypeWhereFor(existing.type),
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
