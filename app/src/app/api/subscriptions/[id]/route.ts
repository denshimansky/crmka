import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  status: z.enum(["pending", "active", "closed", "withdrawn"]).optional(),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной").optional(),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие").optional(),
  discountAmount: z.number().min(0).optional(),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  withdrawalDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
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

  const existing = await db.subscription.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  // Пересчёт сумм при изменении цены/кол-ва занятий/скидки
  const lessonPrice = data.lessonPrice ?? Number(existing.lessonPrice)
  const totalLessons = data.totalLessons ?? existing.totalLessons
  const discountAmount = data.discountAmount ?? Number(existing.discountAmount)
  const totalAmount = lessonPrice * totalLessons
  const finalAmount = totalAmount - discountAmount

  // Пересчитываем баланс: finalAmount - сумма оплат
  const paidSum = await db.payment.aggregate({
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

  if (data.status) {
    updateData.status = data.status
    if (data.status === "active" && !existing.activatedAt) {
      updateData.activatedAt = new Date()
    }
    if (data.status === "withdrawn" && data.withdrawalDate) {
      updateData.withdrawalDate = new Date(data.withdrawalDate)
    }
  }

  if (data.wardId !== undefined) {
    updateData.wardId = data.wardId
  }

  const subscription = await db.subscription.update({
    where: { id },
    data: updateData,
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(subscription)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.subscription.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  await db.subscription.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
