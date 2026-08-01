import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, uniqueSectionSlug, withSlugRetry } from "@/lib/kb"
import { z } from "zod"

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
})

// PATCH /api/admin/kb/sections/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.kbSection.findFirst({ where: { id, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Раздел не найден" }, { status: 404 })

  const data: { title?: string; slug?: string; icon?: string | null; isPublished?: boolean } = {}
  const newTitle = parsed.data.title
  if (parsed.data.icon !== undefined) data.icon = parsed.data.icon
  if (parsed.data.isPublished !== undefined) data.isPublished = parsed.data.isPublished

  // Слаг пересчитываем внутри ретрая: при гонке переименований партиал-UNIQUE
  // отклонит второй апдейт (P2002) — берём следующий свободный слаг.
  const section = await withSlugRetry(async () => {
    if (newTitle !== undefined && newTitle !== existing.title) {
      data.title = newTitle
      data.slug = await uniqueSectionSlug(existing.parentId, newTitle, id)
    }
    return db.kbSection.update({ where: { id }, data })
  })
  return NextResponse.json(section)
}

// DELETE /api/admin/kb/sections/[id] — мягкое удаление раздела вместе с
// подразделами и всеми их статьями (дерево ≤ 3 уровней).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const existing = await db.kbSection.findFirst({ where: { id, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Раздел не найден" }, { status: 404 })

  const children = await db.kbSection.findMany({
    where: { parentId: id, deletedAt: null },
    select: { id: true },
  })
  const sectionIds = [id, ...children.map((c) => c.id)]
  const now = new Date()

  await db.$transaction([
    db.kbArticle.updateMany({ where: { sectionId: { in: sectionIds }, deletedAt: null }, data: { deletedAt: now } }),
    db.kbSection.updateMany({ where: { id: { in: sectionIds } }, data: { deletedAt: now } }),
  ])

  return NextResponse.json({ ok: true })
}
