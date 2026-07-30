import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { DIRECTION_ICON_NAMES } from "@/lib/direction-icons"

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  lessonPrice: z.number().min(0, "Стоимость не может быть отрицательной").optional(),
  lessonDuration: z.number().min(15).max(480).optional(),
  trialPrice: z.number().min(0).nullable().optional(),
  trialFree: z.boolean().optional(),
  singleVisitPrice: z.number().min(0).nullable().optional(),
  packagePrices: z.record(z.string(), z.coerce.number().min(0)).transform((m) => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(m)) {
      if (Number.isFinite(v) && v >= 0) out[k] = v
    }
    return out
  }).nullable().optional(),
  color: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  icon: z.string().nullable().optional().refine(
    v => v == null || DIRECTION_ICON_NAMES.includes(v),
    "Недопустимая иконка",
  ),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.direction.findFirst({ where: { id, tenantId: session.user.tenantId } })
  if (!existing) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  // Запрет дубликатов по названию (без учёта регистра) при переименовании.
  if (parsed.data.name) {
    const dup = await db.direction.findFirst({
      where: {
        tenantId: session.user.tenantId,
        deletedAt: null,
        id: { not: id },
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
      select: { id: true },
    })
    if (dup) {
      return NextResponse.json({ error: "Направление с таким названием уже существует" }, { status: 409 })
    }
  }

  // packagePrices — JSON-поле: null нужно передавать как Prisma.JsonNull (не raw null).
  const { packagePrices, ...rest } = parsed.data
  const data: Prisma.DirectionUpdateInput = { ...rest }
  if (packagePrices !== undefined) {
    data.packagePrices = packagePrices === null ? Prisma.JsonNull : packagePrices
  }

  const direction = await db.direction.update({ where: { id }, data })
  return NextResponse.json(direction)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.direction.findFirst({ where: { id, tenantId: session.user.tenantId } })
  if (!existing) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  await db.direction.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
