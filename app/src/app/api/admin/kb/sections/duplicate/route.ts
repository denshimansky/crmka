import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { canEditKb, duplicateSectionToVariant } from "@/lib/kb"
import { z } from "zod"

// POST /api/admin/kb/sections/duplicate — скопировать верхний раздел целиком
// (подразделы + статьи + блоки) в другую вкладку. Так наполняют вторую вкладку,
// не пересоздавая структуру руками. Оригинал остаётся на месте.
const schema = z.object({
  sectionId: z.string().uuid(),
  targetVariant: z.enum(["calendar", "package"]),
})

export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { sectionId, targetVariant } = parsed.data

  try {
    const created = await duplicateSectionToVariant(sectionId, targetVariant, admin.adminId)
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка копирования" },
      { status: 400 },
    )
  }
}
