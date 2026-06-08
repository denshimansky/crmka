import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { Prisma } from "@prisma/client"
import { z } from "zod"

// accountId/method остались опциональными для обратной совместимости с UI,
// но фактически больше не используются — изменение идёт на Client.clientBalance,
// а не как расход с кассы.
const refundSchema = z.object({
  accountId: z.string().uuid().optional(),
  method: z.string().optional(),
  comment: z.string().max(500).optional(),
})

/**
 * POST /api/subscriptions/[id]/refund
 * Закрытие абонемента с учётом фактически оплаченного и отработанного.
 *
 * Расчёт дельты для Client.clientBalance:
 *   delta = paidToSub - usedAmount
 *     paidToSub  = сумма Payment.transfer_in, привязанных к этому абонементу
 *                  (т.е. суммы, реально списанные с баланса родителя через
 *                  «Оплатить с баланса»).
 *     usedAmount = сумма Attendance.chargeAmount этого абонемента (стоимость
 *                  отработанных занятий).
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
  const { comment } = parsed.data

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

    const paidAgg = await tx.payment.aggregate({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        deletedAt: null,
        type: "transfer_in",
      },
      _sum: { amount: true },
    })
    const usedAgg = await tx.attendance.aggregate({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
      },
      _sum: { chargeAmount: true },
    })
    const attendedCount = await tx.attendance.count({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        chargeAmount: { gt: 0 },
      },
    })

    const paidToSub = new Prisma.Decimal(paidAgg._sum.amount ?? 0)
    const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
    const delta = paidToSub.minus(usedAmount)
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
        balance: 0,
      },
    })

    await tx.groupEnrollment.updateMany({
      where: {
        tenantId: session.user.tenantId,
        clientId: subscription.clientId,
        groupId: subscription.groupId,
        isActive: true,
        deletedAt: null,
      },
      data: {
        isActive: false,
        withdrawnAt: new Date(),
      },
    })

    return {
      data: {
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

  const paidAgg = await db.payment.aggregate({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
      deletedAt: null,
      type: "transfer_in",
    },
    _sum: { amount: true },
  })
  const usedAgg = await db.attendance.aggregate({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
    },
    _sum: { chargeAmount: true },
  })
  const attendedCount = await db.attendance.count({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
      chargeAmount: { gt: 0 },
    },
  })

  const paidToSub = Number(paidAgg._sum.amount ?? 0)
  const usedAmount = Number(usedAgg._sum.chargeAmount ?? 0)
  const balanceDelta = paidToSub - usedAmount
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
