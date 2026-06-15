import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"
import { Prisma } from "@prisma/client"
import { z } from "zod"

// accountId/method остались опциональными для обратной совместимости с UI,
// но фактически больше не используются — изменение идёт на Client.clientBalance,
// а не как расход с кассы.
// withdrawalReasonId — обязательное поле (закрытие = отчисление),
// проверяется внутри обработчика, чтобы вернуть осмысленную ошибку.
const refundSchema = z.object({
  accountId: z.string().uuid().optional(),
  method: z.string().optional(),
  comment: z.string().max(500).optional(),
  withdrawalReasonId: z.string().uuid().optional(),
})

/**
 * POST /api/subscriptions/[id]/refund
 * Закрытие абонемента с учётом фактически оплаченного и отработанного.
 *
 * Расчёт дельты для Client.clientBalance:
 *   delta = paidToSub - usedAmount - priorRefunds
 *     paidToSub  = нетто-оплачено (transfer_in минус унесённое возвратом из
 *                  кассы/переносом баланса — Payment type=refund c минусом),
 *                  см. netPaidToSubscription (Баг #4).
 *     usedAmount = сумма Attendance.chargeAmount этого абонемента (стоимость
 *                  отработанных занятий).
 *     priorRefunds = уже применённые при прошлых закрытиях сверки
 *                  (subscription_closed_refund) — повторное закрытие после
 *                  реактивации не двигает баланс второй раз.
 *
 * delta > 0 → клиент переплатил, возвращаем на баланс (кредит на следующий).
 * delta < 0 → клиент не доплатил за отработанное, переносим долг на баланс.
 * delta = 0 → баланс клиента не меняется (всё «сошлось»).
 *
 * Абонемент → withdrawn, balance=0, зачисления деактивируются.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = refundSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { comment, withdrawalReasonId } = parsed.data

  // Закрытие через refund переводит абонемент в withdrawn — причина обязательна.
  if (!withdrawalReasonId) {
    return NextResponse.json({ error: "Укажите причину отчисления" }, { status: 400 })
  }
  const reason = await db.withdrawalReason.findFirst({
    where: {
      id: withdrawalReasonId,
      tenantId: session.user.tenantId,
      isActive: true,
    },
    select: { id: true },
  })
  if (!reason) {
    return NextResponse.json({ error: "Причина отчисления не найдена" }, { status: 400 })
  }

  const result = await db.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id, tenantId: session.user.tenantId, deletedAt: null },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        direction: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    })

    if (!subscription) {
      return { error: "Абонемент не найден", status: 404 }
    }

    if (subscription.status !== "active" && subscription.status !== "pending") {
      return { error: "Закрытие возможно только для активного или ожидающего абонемента", status: 400 }
    }

    const paidToSub = await netPaidToSubscription(tx, session.user.tenantId, id)
    const usedAgg = await tx.attendance.aggregate({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
      },
      _sum: { chargeAmount: true },
    })
    // Скидки v2: «отхожено» = отметки, списывающие занятие (включая бесплатные
    // при 100% скидке), а не chargeAmount > 0.
    const attendedCount = await tx.attendance.count({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        isPending: false,
        attendanceType: { chargesSubscription: true },
      },
    })
    // Уже применённые сверки прошлых закрытий (знаковая сумма): повторное
    // закрытие после реактивации применяет только недостающую часть.
    const priorAgg = await tx.clientBalanceTransaction.aggregate({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        type: "subscription_closed_refund",
      },
      _sum: { amount: true },
    })

    const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
    const delta = paidToSub
      .minus(usedAmount)
      .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))
    const remainingLessons = Math.max(0, subscription.totalLessons - attendedCount)

    if (!delta.isZero()) {
      await applyBalanceDelta(tx, {
        tenantId: session.user.tenantId,
        clientId: subscription.clientId,
        delta,
        type: "subscription_closed_refund",
        refs: {
          subscriptionId: id,
          directionId: subscription.directionId,
        },
        comment:
          comment ||
          (delta.isPositive()
            ? `Закрытие: возврат за ${remainingLessons} занятий — ${subscription.direction.name} (${subscription.group.name})`
            : `Закрытие: долг ${delta.abs().toFixed(2)} ₽ — ${subscription.direction.name} (${subscription.group.name})`),
        createdBy: session.user.employeeId,
      })
    }

    await tx.subscription.update({
      where: { id },
      data: {
        status: "withdrawn",
        withdrawalDate: new Date(),
        withdrawalReasonId,
        balance: 0,
      },
    })

    // Ребёнок уходит из группы — но только если не осталось другого живого
    // (pending/active) абонемента в этой же группе. Helper заодно чинит scope:
    // раньше деактивация шла по clientId без wardId — у клиента с несколькими
    // подопечными отчислялись зачисления не того ребёнка.
    await deactivateGroupEnrollmentOnWithdrawal(tx, {
      tenantId: session.user.tenantId,
      groupId: subscription.groupId,
      clientId: subscription.clientId,
      wardId: subscription.wardId,
      excludeSubscriptionId: id,
    })

    // Скидки v2: отчисленный выпадает из состава месяца — пересчёт скидок
    // оставшихся абонементов клиента (/refund — основной путь отчисления).
    const discountRecalc = await recalcClientDiscounts(tx, {
      tenantId: session.user.tenantId,
      clientId: subscription.clientId,
      createdBy: session.user.employeeId ?? null,
    })

    return {
      data: {
        discountChanges: discountRecalc.changes,
        subscriptionId: id,
        balanceDelta: delta.toNumber(),
        paidToSubscription: paidToSub.toNumber(),
        usedAmount: usedAmount.toNumber(),
        remainingLessons,
        attendedLessons: attendedCount,
        totalLessons: subscription.totalLessons,
        lessonPrice: Number(subscription.lessonPrice),
        client: subscription.client,
        direction: subscription.direction,
        group: subscription.group,
      },
    }
  })

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result.data)
}

/**
 * GET /api/subscriptions/[id]/refund
 * Предварительный расчёт дельты баланса при закрытии абонемента (без выполнения).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const subscription = await db.subscription.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    include: {
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  if (!subscription) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  }

  // Та же нетто-формула, что в действии (POST здесь и PATCH closed/withdrawn) —
  // иначе превью «вернётся X» расходится с фактическим возвратом (Баг #4).
  const paidToSubDec = await netPaidToSubscription(db, session.user.tenantId, id)
  const usedAgg = await db.attendance.aggregate({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
    },
    _sum: { chargeAmount: true },
  })
  // Скидки v2: «отхожено» по отметкам, не по chargeAmount > 0.
  const attendedCount = await db.attendance.count({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
      isPending: false,
      attendanceType: { chargesSubscription: true },
    },
  })
  const priorAgg = await db.clientBalanceTransaction.aggregate({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
      type: "subscription_closed_refund",
    },
    _sum: { amount: true },
  })

  const paidToSub = paidToSubDec.toNumber()
  const usedAmount = Number(usedAgg._sum.chargeAmount ?? 0)
  const balanceDelta = paidToSub - usedAmount - Number(priorAgg._sum.amount ?? 0)
  const remainingLessons = Math.max(0, subscription.totalLessons - attendedCount)

  return NextResponse.json({
    totalLessons: subscription.totalLessons,
    attendedLessons: attendedCount,
    remainingLessons,
    lessonPrice: Number(subscription.lessonPrice),
    paidToSubscription: paidToSub,
    usedAmount,
    balanceDelta,
    direction: subscription.direction.name,
    group: subscription.group.name,
    status: subscription.status,
    canClose: subscription.status === "active" || subscription.status === "pending",
  })
}
