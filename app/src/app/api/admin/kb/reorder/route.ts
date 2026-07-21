import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb } from "@/lib/kb"
import { z } from "zod"

// POST /api/admin/kb/reorder — сохранить новый порядок соседних элементов.
// Клиент присылает id в нужном порядке, sortOrder = позиция в массиве.
const schema = z.object({
  entity: z.enum(["section", "article", "block"]),
  ids: z.array(z.string().uuid()).min(1),
})

export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { entity, ids } = parsed.data

  await db.$transaction(async (tx) => {
    for (let index = 0; index < ids.length; index++) {
      const where = { id: ids[index] }
      const data = { sortOrder: index }
      if (entity === "section") await tx.kbSection.update({ where, data })
      else if (entity === "article") await tx.kbArticle.update({ where, data })
      else await tx.kbBlock.update({ where, data })
    }
  })

  return NextResponse.json({ ok: true })
}
