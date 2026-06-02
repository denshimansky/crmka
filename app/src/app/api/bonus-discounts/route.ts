// Разовые маркетинговые скидки-бонусы. Начисляются на Client.clientBalance
// через applyBalanceDelta(type=correction) — в ДДС не падают, в отчётах
// маркетинга видны отдельно.

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const createSchema = z.object({
  clientId: z.string().uuid(),
  amount: z.number().positive(),
  date: z.string().min(10),
  comment: z.string().optional(),
  reason: z.string().min(1, "Укажите причину"),
  responsibleId: z.string().uuid().nullable().optional(),
  isMarketing: z.boolean().default(false),
  channelId: z.string().uuid().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")
  const isMarketing = searchParams.get("isMarketing")
  const channelId = searchParams.get("channelId")
  const responsibleId = searchParams.get("responsibleId")

  const where: any = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }
  if (clientId) where.clientId = clientId
  if (channelId) where.channelId = channelId
  if (responsibleId) where.responsibleId = responsibleId
  if (isMarketing !== null) where.isMarketing = isMarketing === "true"
  if (dateFrom || dateTo) {
    where.date = {}
    if (dateFrom) where.date.gte = new Date(dateFrom)
    if (dateTo) where.date.lte = new Date(dateTo)
  }

  const items = await db.bonusDiscount.findMany({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      responsible: { select: { id: true, firstName: true, lastName: true } },
      channel: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 500,
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = session.user.role
  if (role === "readonly" || role === "instructor") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Ошибка валидации" },
      { status: 400 },
    )
  }
  const data = parsed.data

  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  if (data.isMarketing && !data.channelId) {
    return NextResponse.json(
      { error: "Для маркетинговой записи укажите канал" },
      { status: 400 },
    )
  }

  const created = await db.$transaction(async (tx) => {
    const row = await tx.bonusDiscount.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        amount: new Prisma.Decimal(data.amount),
        date: new Date(data.date),
        comment: data.comment ?? null,
        reason: data.reason,
        responsibleId: data.responsibleId ?? session.user.employeeId ?? null,
        isMarketing: data.isMarketing,
        channelId: data.isMarketing ? data.channelId ?? null : null,
        createdBy: session.user.employeeId ?? null,
      },
      include: {
        responsible: { select: { id: true, firstName: true, lastName: true } },
        channel: { select: { id: true, name: true } },
      },
    })
    await applyBalanceDelta(tx, {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      delta: new Prisma.Decimal(data.amount),
      type: "correction",
      comment: `Разовая скидка-бонус: ${data.reason}`,
      createdBy: session.user.employeeId ?? null,
    })
    return row
  })

  return NextResponse.json(created, { status: 201 })
}
