import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, uniqueArticleSlug, withSlugRetry } from "@/lib/kb"
import { z } from "zod"

// GET /api/admin/kb/articles/[id] — статья с блоками (для редактора)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const article = await db.kbArticle.findFirst({
    where: { id, deletedAt: null },
    include: {
      section: { select: { id: true, title: true, slug: true, variant: true } },
      blocks: { orderBy: { sortOrder: "asc" } },
    },
  })
  if (!article) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })
  return NextResponse.json(article)
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  isPublished: z.boolean().optional(),
  sectionId: z.string().uuid().optional(), // перенос в другой раздел
})

// PATCH /api/admin/kb/articles/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.kbArticle.findFirst({ where: { id, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })

  const data: { title?: string; slug?: string; isPublished?: boolean; sectionId?: string; sortOrder?: number } = {}

  // Перенос в другой раздел: пересчитать порядок и слаг в новом разделе.
  const targetSectionId = parsed.data.sectionId && parsed.data.sectionId !== existing.sectionId
    ? parsed.data.sectionId
    : existing.sectionId
  if (targetSectionId !== existing.sectionId) {
    const target = await db.kbSection.findFirst({ where: { id: targetSectionId, deletedAt: null } })
    if (!target) return NextResponse.json({ error: "Целевой раздел не найден" }, { status: 404 })
    data.sectionId = targetSectionId
    const last = await db.kbArticle.findFirst({
      where: { sectionId: targetSectionId, deletedAt: null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })
    data.sortOrder = (last?.sortOrder ?? -1) + 1
  }

  const newTitle = parsed.data.title
  if (parsed.data.isPublished !== undefined) data.isPublished = parsed.data.isPublished

  // Слаг пересчитываем внутри ретрая: при гонке переименований/переносов в один
  // раздел партиал-UNIQUE(section_id, slug) отклонит второй апдейт (P2002) —
  // берём следующий свободный слаг.
  const article = await withSlugRetry(async () => {
    if (newTitle !== undefined && (newTitle !== existing.title || data.sectionId)) {
      data.title = newTitle
      data.slug = await uniqueArticleSlug(targetSectionId, newTitle, id)
    } else if (data.sectionId) {
      // Перенос без переименования — слаг всё равно проверяем на уникальность в новом разделе.
      data.slug = await uniqueArticleSlug(targetSectionId, existing.title, id)
    }
    return db.kbArticle.update({ where: { id }, data })
  })
  return NextResponse.json(article)
}

// DELETE /api/admin/kb/articles/[id] — мягкое удаление статьи
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const existing = await db.kbArticle.findFirst({ where: { id, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })

  await db.kbArticle.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
