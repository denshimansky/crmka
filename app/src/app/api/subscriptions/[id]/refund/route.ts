import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const refundSchema = z.object({
  accountId: z.string().uuid("Некорректный ID счёта"),
  method: z.enum(["cash", "bank_transfer", "acquiring", "online_yukassa", "online_robokassa", "sbp_qr"]),
  comment: z.string().max(500).optional(),
})

/**
 * POST /api/subscriptions/[id]/refund
 * Полный возврат остатка абонемента.
 *
 * Логика:
 * 1. Считаем использованные занятия (attendance с chargeAmount > 0)
 * 2. Остаток занятий = totalLessons - использованные
 * 3. Сумма возврата = остаток занятий × lessonPrice
 * 4. Создаём Payment type=refund с отрицательной суммой
 * 5. Деактивируем абонемент (status=withdrawn)
 * 6. Деактивируем связанные зачисления
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Только владелец и управляющий могут делать возвраты
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = refundSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { accountId, method, comment } = parsed.data

  const result = await db.$transaction(async (tx) => {
    // 1. Находим абонемент
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

    // Возврат только для активных/ожидающих абонементов
    if (subscription.status !== "active" && subscription.status !== "pending") {
      return { error: "Возврат возможен только для активного или ожидающего абонемента", status: 400 }
    }

    // 2. Проверяем что счёт принадлежит тенанту
    const account = await tx.financialAccount.findFirst({
      where: { id: accountId, tenantId: session.user.tenantId, deletedAt: null },
    })
    if (!account) {
      return { error: "Счёт не найден", status: 404 }
    }

    // 3. Считаем использованные занятия
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

    // 4. Считаем фактически оплаченную сумму
    const paidAgg = await tx.payment.aggregate({
      where: { subscriptionId: id, deletedAt: null },
      _sum: { amount: true },
    })
    const totalPaid = Number(paidAgg._sum.amount || 0)

    // Сумма возврата не может превышать фактически оплаченное
    const actualRefund = Math.min(refundAmount, totalPaid)

    if (actualRefund <= 0) {
      return { error: "Нет средств для возврата (абонемент не оплачен)", status: 400 }
    }

    // 5. Создаём платёж-возврат (отрицательная сумма)
    const payment = await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: subscription.clientId,
        subscriptionId: id,
        accountId,
        amount: -actualRefund,
        type: "refund",
        method,
        date: new Date(),
        comment: comment || `Возврат: ${subscription.direction.name} (${subscription.group.name})`,
        createdBy: session.user.employeeId,
      },
    })

    // 6. Деактивируем абонемент
    const newBalance = Number(subscription.finalAmount) - (totalPaid - actualRefund)
    await tx.subscription.update({
      where: { id },
      data: {
        status: "withdrawn",
        withdrawalDate: new Date(),
        balance: newBalance,
      },
    })

    // 7. Деактивируем связанные зачисления
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
        paymentId: payment.id,
        subscriptionId: id,
        refundAmount: actualRefund,
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
  const actualRefund = Math.min(refundAmount, totalPaid)

  return NextResponse.json({
    totalLessons: subscription.totalLessons,
    attendedLessons: attendedCount,
    remainingLessons,
    lessonPrice: Number(subscription.lessonPrice),
    refundAmount: actualRefund,
    totalPaid,
    direction: subscription.direction.name,
    group: subscription.group.name,
    status: subscription.status,
    canRefund: (subscription.status === "active" || subscription.status === "pending") && actualRefund > 0 && remainingLessons > 0,
  })
}
