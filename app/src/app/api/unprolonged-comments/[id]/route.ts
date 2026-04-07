import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  comment: z.string().min(1, "Комментарий обязателен"),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.unprolongedComment.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      subscription: { select: { id: true, status: true } },
      creator: { select: { id: true, name: true } },
    },
  })
  if (!item) return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 })

  return NextResponse.json(item)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.unprolongedComment.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 })

  const item = await db.unprolongedComment.update({
    where: { id },
    data: { comment: parsed.data.comment },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      subscription: { select: { id: true, status: true } },
      creator: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.unprolongedComment.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 })

  await db.unprolongedComment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
