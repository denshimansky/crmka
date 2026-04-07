import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().optional(),
  bonusType: z.enum(["per_trial", "per_sale", "per_upsale"]).optional(),
  amount: z.number().min(0).optional(),
  channels: z.any().optional(),
  isActive: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.adminBonusSettings.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      employee: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  })
  if (!item) return NextResponse.json({ error: "Настройка бонуса не найдена" }, { status: 404 })

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

  const existing = await db.adminBonusSettings.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Настройка бонуса не найдена" }, { status: 404 })

  const item = await db.adminBonusSettings.update({
    where: { id },
    data: parsed.data,
    include: {
      employee: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.adminBonusSettings.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Настройка бонуса не найдена" }, { status: 404 })

  await db.adminBonusSettings.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
