import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  lessonsCount: z.number().int().min(1).max(1000).optional(),
  validDays: z.number().int().min(1).max(3650).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// PATCH /api/package-templates/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as { tenantId: string }).tenantId

  const existing = await db.packageTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  // Если меняется lessonsCount — проверить дубли среди активных
  if (
    parsed.data.lessonsCount !== undefined &&
    parsed.data.lessonsCount !== existing.lessonsCount
  ) {
    const duplicate = await db.packageTemplate.findFirst({
      where: {
        tenantId,
        lessonsCount: parsed.data.lessonsCount,
        deletedAt: null,
        NOT: { id },
      },
    })
    if (duplicate) {
      return NextResponse.json(
        { error: `Шаблон на ${parsed.data.lessonsCount} занятий уже существует` },
        { status: 409 },
      )
    }
  }

  const updated = await db.packageTemplate.update({
    where: { id },
    data: parsed.data,
  })
  return NextResponse.json(updated)
}

// DELETE /api/package-templates/[id] — soft delete.
// Существующие абонементы с packageTemplateId сохраняют ссылку (поле nullable, ON DELETE SET NULL).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as { tenantId: string }).tenantId

  const existing = await db.packageTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })

  await db.packageTemplate.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  })
  return NextResponse.json({ ok: true })
}
