import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { recalcLinkedDiscounts } from "@/lib/linked-discount"
import { recalculateDiscountsForClient } from "@/lib/discounts/recalculate-for-client"
import { applyBalanceDelta } from "@/lib/balance/transactions"

const updateSchema = z.object({
  status: z.enum(["pending", "active", "closed", "withdrawn"]).optional(),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной").optional(),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие").optional(),
  discountAmount: z.number().min(0).optional(),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  withdrawalDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
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

  // Транзакция: findFirst + update атомарно (M-5 audit fix)
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: { id, tenantId: session.user.tenantId, deletedAt: null },
    })
    if (!existing) return null

    // Пересчёт сумм при изменении цены/кол-ва занятий/скидки
    const lessonPrice = data.lessonPrice ?? Number(existing.lessonPrice)
    const totalLessons = data.totalLessons ?? existing.totalLessons
    const discountAmount = data.discountAmount ?? Number(existing.discountAmount)
    const totalAmount = lessonPrice * totalLessons
    const finalAmount = totalAmount - discountAmount

    // Пересчитываем баланс: finalAmount - сумма оплат
    const paidSum = await tx.payment.aggregate({
      where: { subscriptionId: id, deletedAt: null },
      _sum: { amount: true },
    })
    const paid = Number(paidSum._sum.amount || 0)
    const balance = finalAmount - paid

    const updateData: any = {
      lessonPrice,
      totalLessons,
      totalAmount,
      discountAmount,
      finalAmount,
      balance,
    }

    // «Отчислить» = withdrawn → дополнительно:
    //   1) посчитать остаток занятий и вернуть деньги на client.clientBalance,
    //   2) деактивировать GroupEnrollment (ребёнок уходит из группы и расписания),
    //   3) обнулить subscription.balance, потому что мы его уже вернули.
    let refundedAmount = 0
    if (data.status === "withdrawn" && existing.status !== "withdrawn") {
      const attendedCount = await tx.attendance.count({
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: id,
          chargeAmount: { gt: 0 },
        },
      })
      const remainingLessons = Math.max(0, existing.totalLessons - attendedCount)
      refundedAmount = remainingLessons * Number(existing.lessonPrice)

      if (refundedAmount > 0) {
        await applyBalanceDelta(tx, {
          tenantId: session.user.tenantId,
          clientId: existing.clientId,
          delta: refundedAmount,
          type: "subscription_closed_refund",
          refs: { subscriptionId: id, directionId: existing.directionId },
          comment: `Отчисление: возврат за ${remainingLessons} занятий`,
          createdBy: session.user.employeeId,
        })
        updateData.balance = 0
      }

      // ребёнок уходит из группы → исчезает из расписания (Lessons продолжают
      // существовать как объекты, но без зачисления = без посещения).
      const wardScope = existing.wardId ? { wardId: existing.wardId } : { clientId: existing.clientId }
      await tx.groupEnrollment.updateMany({
        where: {
          tenantId: session.user.tenantId,
          groupId: existing.groupId,
          isActive: true,
          deletedAt: null,
          ...wardScope,
        },
        data: { isActive: false, withdrawnAt: new Date() },
      })
    }

    if (data.status) {
      updateData.status = data.status
      if (data.status === "active" && !existing.activatedAt) {
        updateData.activatedAt = new Date()
      }
      if (data.status === "withdrawn") {
        updateData.withdrawalDate = data.withdrawalDate
          ? new Date(data.withdrawalDate)
          : new Date()
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

    // SUB-07: при отчислении/закрытии пересчитать связанные скидки
    // (старая логика для записей без templateId).
    let linkedDiscountChanges: Awaited<ReturnType<typeof recalcLinkedDiscounts>> = []
    if (data.status === "withdrawn" || data.status === "closed") {
      linkedDiscountChanges = await recalcLinkedDiscounts(
        tx,
        session.user.tenantId,
        existing.clientId,
        id
      )
      // Новая логика: пересчитать шаблонные скидки клиента — состав
      // активных абонементов изменился, для linked может смениться адресат.
      await recalculateDiscountsForClient(tx, {
        tenantId: session.user.tenantId,
        clientId: existing.clientId,
        createdBy: session.user.employeeId ?? null,
      })
    }

    return { subscription, linkedDiscountChanges, refundedAmount }
  })

  if (!result) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  const response: any = { ...result.subscription }
  if (result.linkedDiscountChanges.length > 0) {
    response._linkedDiscountWarning = {
      message: `Связанная скидка снята с ${result.linkedDiscountChanges.length} абонемент(ов), т.к. активных абонементов стало меньше 2`,
      affected: result.linkedDiscountChanges,
    }
  }
  if (result.refundedAmount > 0) {
    response._refunded = result.refundedAmount
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

    await tx.subscription.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return true
  })

  if (!deleted) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
