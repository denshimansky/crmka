import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const transferSchema = z.object({
  targetSubscriptionId: z.string().uuid("Некорректный ID целевого абонемента"),
  amount: z.number().positive("Сумма должна быть больше 0"),
})

/**
 * POST /api/subscriptions/[id]/transfer-balance
 * Перенос баланса (оплаченных средств) с одного абонемента на другой.
 *
 * Логика:
 * 1. Проверяем что оба абонемента принадлежат одному клиенту и тенанту
 * 2. Считаем доступную для переноса сумму (оплачено − использовано)
 * 3. Создаём два Payment: refund на источнике, transfer_in на цели
 * 4. Пересчитываем balance обоих абонементов
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Только владелец и управляющий
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id: sourceId } = await params
  const body = await req.json()
  const parsed = transferSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { targetSubscriptionId, amount } = parsed.data

  if (sourceId === targetSubscriptionId) {
    return NextResponse.json({ error: "Нельзя переносить баланс на тот же абонемент" }, { status: 400 })
  }

  const result = await db.$transaction(async (tx) => {
    // 1. Находим оба абонемента
    const source = await tx.subscription.findFirst({
      where: { id: sourceId, tenantId: session.user.tenantId, deletedAt: null },
      include: {
        direction: { select: { name: true } },
        group: { select: { name: true } },
      },
    })
    if (!source) return { error: "Абонемент-источник не найден", status: 404 }

    const target = await tx.subscription.findFirst({
      where: { id: targetSubscriptionId, tenantId: session.user.tenantId, deletedAt: null },
      include: {
        direction: { select: { name: true } },
        group: { select: { name: true } },
      },
    })
    if (!target) return { error: "Абонемент-получатель не найден", status: 404 }

    // 2. Проверяем что оба принадлежат одному клиенту
    if (source.clientId !== target.clientId) {
      return { error: "Абонементы должны принадлежать одному клиенту", status: 400 }
    }

    // 3. Проверяем статусы
    if (source.status !== "active" && source.status !== "pending" && source.status !== "closed") {
      return { error: "Перенос возможен только из активного, ожидающего или закрытого абонемента", status: 400 }
    }
    if (target.status !== "active" && target.status !== "pending") {
      return { error: "Перенос возможен только в активный или ожидающий абонемент", status: 400 }
    }

    // 4. Считаем доступную сумму на источнике
    const sourcePaidAgg = await tx.payment.aggregate({
      where: { subscriptionId: sourceId, deletedAt: null },
      _sum: { amount: true },
    })
    const sourcePaid = Number(sourcePaidAgg._sum.amount || 0)
    const sourceAvailable = sourcePaid - Number(source.chargedAmount)

    if (sourceAvailable <= 0) {
      return { error: "На абонементе нет доступных средств для переноса", status: 400 }
    }

    if (amount > sourceAvailable) {
      return {
        error: `Максимальная сумма для переноса: ${sourceAvailable.toFixed(2)} ₽`,
        status: 400,
      }
    }

    // 5. Находим первый активный счёт тенанта (для учётных записей)
    const account = await tx.financialAccount.findFirst({
      where: { tenantId: session.user.tenantId, isActive: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
    })
    if (!account) {
      return { error: "Нет активного счёта. Создайте хотя бы одну кассу", status: 400 }
    }

    const today = new Date()
    const commentOut = `Перенос на: ${target.direction.name} (${target.group.name})`
    const commentIn = `Перенос с: ${source.direction.name} (${source.group.name})`

    // 6. Создаём Payment-списание на источнике (отрицательная сумма, как возврат)
    await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: source.clientId,
        subscriptionId: sourceId,
        accountId: account.id,
        amount: -amount,
        type: "refund",
        method: "bank_transfer",
        date: today,
        comment: commentOut,
        createdBy: session.user.employeeId,
      },
    })

    // 7. Создаём Payment-зачисление на цель (положительная сумма)
    await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: target.clientId,
        subscriptionId: targetSubscriptionId,
        accountId: account.id,
        amount: amount,
        type: "transfer_in",
        method: "bank_transfer",
        date: today,
        comment: commentIn,
        createdBy: session.user.employeeId,
      },
    })

    // 8. Пересчитываем balance обоих абонементов
    const newSourcePaidAgg = await tx.payment.aggregate({
      where: { subscriptionId: sourceId, deletedAt: null },
      _sum: { amount: true },
    })
    const newSourcePaid = Number(newSourcePaidAgg._sum.amount || 0)
    const newSourceBalance = Number(source.finalAmount) - newSourcePaid

    const newTargetPaidAgg = await tx.payment.aggregate({
      where: { subscriptionId: targetSubscriptionId, deletedAt: null },
      _sum: { amount: true },
    })
    const newTargetPaid = Number(newTargetPaidAgg._sum.amount || 0)
    const newTargetBalance = Number(target.finalAmount) - newTargetPaid

    await tx.subscription.update({
      where: { id: sourceId },
      data: { balance: newSourceBalance },
    })

    await tx.subscription.update({
      where: { id: targetSubscriptionId },
      data: { balance: newTargetBalance },
    })

    return {
      data: {
        amount,
        source: {
          id: sourceId,
          direction: source.direction.name,
          group: source.group.name,
          oldBalance: Number(source.balance),
          newBalance: newSourceBalance,
        },
        target: {
          id: targetSubscriptionId,
          direction: target.direction.name,
          group: target.group.name,
          oldBalance: Number(target.balance),
          newBalance: newTargetBalance,
        },
      },
    }
  })

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result.data)
}

/**
 * GET /api/subscriptions/[id]/transfer-balance
 * Предварительный расчёт доступной суммы + список абонементов-получателей.
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

  // Считаем доступную сумму
  const paidAgg = await db.payment.aggregate({
    where: { subscriptionId: id, deletedAt: null },
    _sum: { amount: true },
  })
  const totalPaid = Number(paidAgg._sum.amount || 0)
  const available = Math.max(0, totalPaid - Number(subscription.chargedAmount))

  // Находим другие абонементы этого клиента (active/pending)
  const targets = await db.subscription.findMany({
    where: {
      tenantId: session.user.tenantId,
      clientId: subscription.clientId,
      id: { not: id },
      status: { in: ["active", "pending"] },
      deletedAt: null,
    },
    include: {
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  })

  return NextResponse.json({
    sourceId: id,
    direction: subscription.direction.name,
    group: subscription.group.name,
    totalPaid,
    chargedAmount: Number(subscription.chargedAmount),
    available,
    balance: Number(subscription.balance),
    targets: targets.map((t) => ({
      id: t.id,
      direction: t.direction.name,
      group: t.group.name,
      periodYear: t.periodYear,
      periodMonth: t.periodMonth,
      balance: Number(t.balance),
      status: t.status,
    })),
  })
}
