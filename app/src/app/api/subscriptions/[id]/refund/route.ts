import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { z } from "zod"

// accountId/method остались опциональными для обратной совместимости с UI,
// но фактически больше не используются — возврат идёт на Client.clientBalance,
// а не как расход с кассы.
const refundSchema = z.object({
  accountId: z.string().uuid().optional(),
  method: z.string().optional(),
  comment: z.string().max(500).optional(),
})

/**
 * POST /api/subscriptions/[id]/refund
 * Закрытие абонемента с возвратом невыработанной части на баланс клиента.
 *
 * Логика:
 * 1. Считаем использованные занятия (attendance с chargeAmount > 0).
 * 2. Остаток занятий = totalLessons − использованные.
 * 3. Сумма возврата = остаток × lessonPrice.
 * 4. Возвращаем на Client.clientBalance через ClientBalanceTransaction
 *    (type=subscription_closed_refund). Клиент сможет потратить кредит
 *    на следующий абонемент.
 * 5. Деактивируем абонемент (status=withdrawn) и зачисления.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Только владелец и управляющий могут делать возвраты
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
      return { error: "Возврат возможен только для активного или ожидающего абонемента", status: 400 }
    }

    const attendedCount = await tx.attendance.count({
      where: {
        tenantId: session.user.tenantId,
        subscriptionId: id,
        chargeAmount: { gt: 0 },
      },
    })

    const remainingLessons = Math.max(0, subscription.totalLessons - attendedCount)

    if (remainingLessons === 0) {
      return { error: "Все занятия использованы, возврат невозможен", status: 400 }
    }

    const refundAmount = remainingLessons * Number(subscription.lessonPrice)

    // Возврат на баланс клиента (не на кассу). Финансово это «обнуление»
    // того минуса, который мы создали при выписке абонемента.
    await applyBalanceDelta(tx, {
      tenantId: session.user.tenantId,
      clientId: subscription.clientId,
      delta: refundAmount,
      type: "subscription_closed_refund",
      refs: {
        subscriptionId: id,
        directionId: subscription.directionId,
      },
      comment: comment || `Возврат: ${subscription.direction.name} (${subscription.group.name})`,
      createdBy: session.user.employeeId,
    })

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
        refundAmount,
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
 * Предварительный расчёт суммы возврата (без выполнения).
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

  const attendedCount = await db.attendance.count({
    where: {
      tenantId: session.user.tenantId,
      subscriptionId: id,
      chargeAmount: { gt: 0 },
    },
  })

  const remainingLessons = Math.max(0, subscription.totalLessons - attendedCount)
  const refundAmount = remainingLessons * Number(subscription.lessonPrice)

  const paidAgg = await db.payment.aggregate({
    where: { subscriptionId: id, deletedAt: null },
    _sum: { amount: true },
  })
  const totalPaid = Number(paidAgg._sum.amount || 0)

  return NextResponse.json({
    totalLessons: subscription.totalLessons,
    attendedLessons: attendedCount,
    remainingLessons,
    lessonPrice: Number(subscription.lessonPrice),
    refundAmount,
    totalPaid,
    direction: subscription.direction.name,
    group: subscription.group.name,
    status: subscription.status,
    canRefund: (subscription.status === "active" || subscription.status === "pending") && remainingLessons > 0,
  })
}
