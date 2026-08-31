import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditAiFaq, AI_FAQ_CATEGORIES } from "@/lib/ai-faq"
import { z } from "zod"

const patchSchema = z.object({
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(4000).optional(),
  category: z.enum(AI_FAQ_CATEGORIES).optional(),
  keywords: z.string().max(500).nullable().optional(),
  isCore: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// PATCH /api/admin/ai-faq/[id] — правка записи или переключение активности.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditAiFaq(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const d = parsed.data

  const data: Record<string, unknown> = {}
  if (d.question !== undefined) data.question = d.question.trim()
  if (d.answer !== undefined) data.answer = d.answer.trim()
  if (d.category !== undefined) data.category = d.category
  if (d.keywords !== undefined) data.keywords = d.keywords?.trim() || null
  if (d.isCore !== undefined) data.isCore = d.isCore
  if (d.isActive !== undefined) data.isActive = d.isActive
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 })
  }

  const { count } = await db.aiFaq.updateMany({ where: { id }, data })
  if (count === 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/ai-faq/[id] — удалить запись (жёстко; записи мелкие и курируемые).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditAiFaq(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const { id } = await params
  const { count } = await db.aiFaq.deleteMany({ where: { id } })
  if (count === 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
