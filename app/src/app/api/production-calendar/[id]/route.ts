import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  isWorking: z.boolean().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

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

  const existing = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  const item = await db.productionCalendar.update({ where: { id }, data: parsed.data })
  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  await db.productionCalendar.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
