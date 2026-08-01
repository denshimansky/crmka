import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, duplicateArticle } from "@/lib/kb"
import { z } from "zod"

// POST /api/admin/kb/articles/duplicate — скопировать статью (с блоками) в
// целевой раздел. Основной сценарий — «вставить» статью из одной вкладки в
// другую, но работает и внутри одной вкладки. Оригинал остаётся на месте.
const schema = z.object({
  sourceArticleId: z.string().uuid(),
  targetSectionId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { sourceArticleId, targetSectionId } = parsed.data

  try {
    const created = await db.$transaction((tx) =>
      duplicateArticle(tx, sourceArticleId, targetSectionId, admin.adminId),
    )
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка копирования" },
      { status: 400 },
    )
  }
}
