import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditAiFaq, AI_FAQ_CATEGORIES } from "@/lib/ai-faq"
import { z } from "zod"

// GET /api/admin/ai-faq — все записи ручной базы знаний ИИ (для редактора).
// Читают все админ-роли; правят — только superadmin/development (canEdit).
export async function GET() {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const items = await db.aiFaq.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  })
  return NextResponse.json({ items, canEdit: canEditAiFaq(admin) })
}

const createSchema = z.object({
  question: z.string().min(1, "Вопрос обязателен").max(500),
  answer: z.string().min(1, "Ответ обязателен").max(4000),
  category: z.enum(AI_FAQ_CATEGORIES).default("navigation"),
  keywords: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  // Ядро — запись идёт в КАЖДЫЙ промпт, минуя отбор по теме (lib/ai-faq-select.ts).
  isCore: z.boolean().optional(),
  sourceLogId: z.string().uuid().nullable().optional(),
})

// POST /api/admin/ai-faq — создать запись. sourceLogId (опц.) — из какого диалога
// родился факт (проставляется при переходе «→ В базу знаний» из /admin/ai-review).
export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditAiFaq(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const d = parsed.data

  const last = await db.aiFaq.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
  const item = await db.aiFaq.create({
    data: {
      question: d.question.trim(),
      answer: d.answer.trim(),
      category: d.category,
      keywords: d.keywords?.trim() || null,
      isActive: d.isActive ?? true,
      isCore: d.isCore ?? false,
      source: d.sourceLogId ? "review" : "manual",
      sourceLogId: d.sourceLogId ?? null,
      createdBy: admin.email,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  })
  return NextResponse.json(item, { status: 201 })
}
