import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  clientId: z.string().uuid("Укажите клиента"),
  subscriptionId: z.string().uuid("Укажите абонемент"),
  periodYear: z.number().int().min(2020).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  comment: z.string().min(1, "Комментарий обязателен"),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const subscriptionId = searchParams.get("subscriptionId")
  const year = searchParams.get("year")
  const month = searchParams.get("month")

  const where: any = {
    tenantId: session.user.tenantId,
  }

  if (clientId) where.clientId = clientId
  if (subscriptionId) where.subscriptionId = subscriptionId
  if (year) where.periodYear = parseInt(year, 10)
  if (month) where.periodMonth = parseInt(month, 10)

  const items = await db.unprolongedComment.findMany({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      subscription: { select: { id: true, status: true } },
      creator: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем клиента
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const item = await db.unprolongedComment.create({
    data: {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      subscriptionId: data.subscriptionId,
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      comment: data.comment,
      createdBy: session.user.employeeId,
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      subscription: { select: { id: true, status: true } },
      creator: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(item, { status: 201 })
}
