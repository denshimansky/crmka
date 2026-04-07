import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  isRead: z.boolean(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // "read-all" — пометить все уведомления как прочитанные
  if (id === "read-all") {
    await db.notification.updateMany({
      where: {
        tenantId: session.user.tenantId,
        employeeId: session.user.employeeId,
        isRead: false,
      },
      data: { isRead: true },
    })
    return NextResponse.json({ ok: true })
  }

  const item = await db.notification.findFirst({
    where: { id, tenantId: session.user.tenantId, employeeId: session.user.employeeId },
  })
  if (!item) return NextResponse.json({ error: "Уведомление не найдено" }, { status: 404 })

  return NextResponse.json(item)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.notification.findFirst({
    where: { id, tenantId: session.user.tenantId, employeeId: session.user.employeeId },
  })
  if (!existing) return NextResponse.json({ error: "Уведомление не найдено" }, { status: 404 })

  const item = await db.notification.update({ where: { id }, data: parsed.data })
  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await db.notification.findFirst({
    where: { id, tenantId: session.user.tenantId, employeeId: session.user.employeeId },
  })
  if (!existing) return NextResponse.json({ error: "Уведомление не найдено" }, { status: 404 })

  await db.notification.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
