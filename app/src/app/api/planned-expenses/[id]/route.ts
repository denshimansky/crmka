import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  periodYear: z.number().int().min(2020).max(2100).optional(),
  periodMonth: z.number().int().min(1).max(12).optional(),
  plannedAmount: z.number().min(0).optional(),
  paidAmount: z.number().min(0).optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.plannedExpense.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      category: { select: { id: true, name: true, isVariable: true } },
      employee: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  })
  if (!item) return NextResponse.json({ error: "Плановый расход не найден" }, { status: 404 })

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

  const existing = await db.plannedExpense.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Плановый расход не найден" }, { status: 404 })

  const item = await db.plannedExpense.update({
    where: { id },
    data: parsed.data,
    include: {
      category: { select: { id: true, name: true, isVariable: true } },
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
  const existing = await db.plannedExpense.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Плановый расход не найден" }, { status: 404 })

  await db.plannedExpense.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
