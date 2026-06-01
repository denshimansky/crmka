import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isVariable: z.boolean().optional(),
  isSalary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// PATCH /api/expense-categories/[id] — обновить.
// Системные категории: имя не редактируем, но флаги isVariable/isSalary/sortOrder/isActive
// можно менять (это бизнес-правила тенанта, не идентичность категории).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.expenseCategory.findFirst({
    where: { id, OR: [{ tenantId: null }, { tenantId }] },
  })
  if (!existing) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined && !existing.isSystem) data.name = parsed.data.name
  if (parsed.data.isVariable !== undefined) data.isVariable = parsed.data.isVariable
  if (parsed.data.isSalary !== undefined) data.isSalary = parsed.data.isSalary
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder

  const updated = await db.expenseCategory.update({ where: { id }, data })
  return NextResponse.json(updated)
}

// DELETE /api/expense-categories/[id] — soft delete (деактивация). Системные нельзя удалить.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.expenseCategory.findFirst({
    where: { id, OR: [{ tenantId: null }, { tenantId }] },
  })
  if (!existing) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })

  if (existing.isSystem) {
    return NextResponse.json({ error: "Системную категорию нельзя удалить" }, { status: 403 })
  }

  await db.expenseCategory.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
