import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, uniqueArticleSlug } from "@/lib/kb"
import { z } from "zod"

const createSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1, "Название обязательно"),
})

// POST /api/admin/kb/articles — создать статью в разделе
export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { sectionId, title } = parsed.data

  const section = await db.kbSection.findFirst({ where: { id: sectionId, deletedAt: null } })
  if (!section) return NextResponse.json({ error: "Раздел не найден" }, { status: 404 })

  const slug = await uniqueArticleSlug(sectionId, title)
  const last = await db.kbArticle.findFirst({
    where: { sectionId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const article = await db.kbArticle.create({
    data: {
      sectionId,
      title,
      slug,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: admin.adminId,
    },
  })
  return NextResponse.json(article, { status: 201 })
}
