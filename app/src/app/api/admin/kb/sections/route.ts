import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb, uniqueSectionSlug } from "@/lib/kb"
import { z } from "zod"

// GET /api/admin/kb/sections — всё дерево разделов (с их статьями) для редактора.
// Возвращаем плоский список (клиент собирает дерево по parentId); включаем и
// снятые с публикации, но не удалённые.
export async function GET() {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sections = await db.kbSection.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      variant: true,
      title: true,
      slug: true,
      icon: true,
      sortOrder: true,
      isPublished: true,
      articles: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, slug: true, sortOrder: true, isPublished: true },
      },
    },
  })
  return NextResponse.json(sections)
}

const createSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1, "Название обязательно"),
  icon: z.string().nullable().optional(),
  // Вкладка для верхнего раздела. У подраздела игнорируется — наследует variant родителя.
  variant: z.enum(["calendar", "package"]).optional(),
})

// POST /api/admin/kb/sections — создать раздел/подраздел
export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { title, icon } = parsed.data
  const parentId = parsed.data.parentId ?? null

  // Вкладка: у подраздела = вкладке родителя; у верхнего — из тела (по умолчанию calendar).
  let variant: "calendar" | "package" = parsed.data.variant ?? "calendar"

  // Максимум два уровня разделов (раздел → подраздел); статьи — третий уровень.
  if (parentId) {
    const parent = await db.kbSection.findFirst({ where: { id: parentId, deletedAt: null } })
    if (!parent) return NextResponse.json({ error: "Родительский раздел не найден" }, { status: 404 })
    if (parent.parentId) {
      return NextResponse.json({ error: "Максимум два уровня разделов" }, { status: 400 })
    }
    variant = parent.variant
  }

  const slug = await uniqueSectionSlug(parentId, title)
  const last = await db.kbSection.findFirst({
    where: { parentId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const section = await db.kbSection.create({
    data: {
      parentId,
      variant,
      title,
      slug,
      icon: icon ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  })
  return NextResponse.json(section, { status: 201 })
}
