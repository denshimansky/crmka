import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const createSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  directionId: z.string().uuid("Некорректный ID направления"),
  groupId: z.string().uuid("Некорректный ID группы"),
  periodYear: z.number().int().min(2020, "Некорректный год").max(2100),
  periodMonth: z.number().int().min(1, "Месяц от 1 до 12").max(12, "Месяц от 1 до 12"),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной"),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  startDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  discountAmount: z.number().min(0).default(0),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const status = searchParams.get("status")
  const periodYear = searchParams.get("periodYear")
  const periodMonth = searchParams.get("periodMonth")

  const where: Prisma.SubscriptionWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  if (clientId) where.clientId = clientId
  if (status) where.status = status as any
  if (periodYear) where.periodYear = parseInt(periodYear)
  if (periodMonth) where.periodMonth = parseInt(periodMonth)

  const subscriptions = await db.subscription.findMany({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      payments: { select: { id: true, amount: true, date: true, method: true }, where: { deletedAt: null } },
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
    take: 200,
  })

  return NextResponse.json(subscriptions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем что клиент принадлежит тенанту
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Проверяем группу
  const group = await db.group.findFirst({
    where: { id: data.groupId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const totalAmount = data.lessonPrice * data.totalLessons
  const finalAmount = totalAmount - data.discountAmount
  const balance = finalAmount // Сколько ещё нужно оплатить

  // Дата начала: startDate или 1-е число месяца
  const startDate = data.startDate
    ? new Date(data.startDate)
    : new Date(data.periodYear, data.periodMonth - 1, 1)

  const subscription = await db.subscription.create({
    data: {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      directionId: data.directionId,
      groupId: data.groupId,
      type: "calendar",
      status: "pending",
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      lessonPrice: data.lessonPrice,
      totalLessons: data.totalLessons,
      totalAmount,
      discountAmount: data.discountAmount,
      finalAmount,
      balance,
      startDate,
      createdBy: session.user.employeeId,
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(subscription, { status: 201 })
}
