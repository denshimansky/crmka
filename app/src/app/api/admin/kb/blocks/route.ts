import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, buildBlockFields } from "@/lib/kb"
import { z } from "zod"

const createSchema = z.object({
  articleId: z.string().uuid(),
  type: z.enum(["heading", "text", "image", "video"]),
  text: z.string().nullable().optional(),
  level: z.number().int().nullable().optional(),
  mediaUrl: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
})

// POST /api/admin/kb/blocks — добавить блок в статью
export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { articleId, type } = parsed.data

  const article = await db.kbArticle.findFirst({ where: { id: articleId, deletedAt: null } })
  if (!article) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })

  const fields = buildBlockFields(type, parsed.data)
  if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 })

  const last = await db.kbBlock.findFirst({
    where: { articleId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const block = await db.kbBlock.create({
    data: { articleId, type, ...fields.data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  })
  return NextResponse.json(block, { status: 201 })
}
