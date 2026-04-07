import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  type: z.enum(["permanent", "one_time", "linked"]).optional(),
  valueType: z.enum(["percent", "fixed"]).optional(),
  value: z.number().min(0).optional(),
  isStackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!item) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

  return NextResponse.json(item)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const existing = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

  const item = await db.discountTemplate.update({ where: { id }, data: parsed.data })
  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

  await db.discountTemplate.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
