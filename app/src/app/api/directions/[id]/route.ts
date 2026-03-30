import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  lessonPrice: z.number().min(0, "Стоимость не может быть отрицательной").optional(),
  lessonDuration: z.number().min(15).max(480).optional(),
  trialPrice: z.number().min(0).nullable().optional(),
  trialFree: z.boolean().optional(),
  color: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
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

  const direction = await db.direction.update({ where: { id }, data: parsed.data })
  return NextResponse.json(direction)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  await db.direction.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
