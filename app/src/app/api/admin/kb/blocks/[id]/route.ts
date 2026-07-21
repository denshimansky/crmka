import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, buildBlockFields } from "@/lib/kb"
import { z } from "zod"

const updateSchema = z.object({
  text: z.string().nullable().optional(),
  level: z.number().int().nullable().optional(),
  mediaUrl: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
})

// PATCH /api/admin/kb/blocks/[id] — изменить содержимое блока (тип не меняем)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.kbBlock.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Блок не найден" }, { status: 404 })

  // Значения по умолчанию — из существующего блока, чтобы можно было менять
  // только часть полей.
  const fields = buildBlockFields(existing.type, {
    text: parsed.data.text !== undefined ? parsed.data.text : existing.text,
    level: parsed.data.level !== undefined ? parsed.data.level : existing.level,
    mediaUrl: parsed.data.mediaUrl !== undefined ? parsed.data.mediaUrl : existing.mediaUrl,
    caption: parsed.data.caption !== undefined ? parsed.data.caption : existing.caption,
  })
  if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 })

  const block = await db.kbBlock.update({ where: { id }, data: fields.data })
  return NextResponse.json(block)
}

// DELETE /api/admin/kb/blocks/[id] — жёсткое удаление блока
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const existing = await db.kbBlock.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Блок не найден" }, { status: 404 })

  await db.kbBlock.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
