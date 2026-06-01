import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// PATCH /api/income-categories/[id] — обновить пользовательскую категорию.
// Системные категории (tenantId = null) защищены: имя/sortOrder/active не редактируются.
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

  const existing = await db.incomeCategory.findFirst({
    where: { id, OR: [{ tenantId: null }, { tenantId }] },
  })
  if (!existing) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })

  if (existing.isSystem) {
    return NextResponse.json({ error: "Системную категорию нельзя редактировать" }, { status: 403 })
  }

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  const updated = await db.incomeCategory.update({
    where: { id },
    data: parsed.data,
  })
  return NextResponse.json(updated)
}

// DELETE /api/income-categories/[id] — soft delete (деактивация).
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

  const existing = await db.incomeCategory.findFirst({
    where: { id, OR: [{ tenantId: null }, { tenantId }] },
  })
  if (!existing) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })

  if (existing.isSystem) {
    return NextResponse.json({ error: "Системную категорию нельзя удалить" }, { status: 403 })
  }

  await db.incomeCategory.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
