import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// Контакты филиала для ЛК родителя. Отдельный роут (а не PATCH /api/branches/[id]):
// сам филиал правит только owner, а контакты кабинета — owner и manager,
// как остальные настройки ЛК (PATCH /api/organization).

const urlField = z
  .string()
  .url("Введите корректную ссылку (https://…)")
  .or(z.literal(""))
  .nullable()
  .optional()

const schema = z.object({
  contactPhone: z.string().max(30).nullable().optional(),
  contactWhatsapp: urlField,
  contactTelegram: urlField,
  contactMax: urlField,
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const branch = await db.branch.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 }
    )
  }

  const data: Record<string, string | null> = {}
  for (const key of ["contactPhone", "contactWhatsapp", "contactTelegram", "contactMax"] as const) {
    const value = parsed.data[key]
    if (value !== undefined) data[key] = value?.trim() || null
  }

  const updated = await db.branch.update({ where: { id }, data })
  return NextResponse.json({
    id: updated.id,
    contactPhone: updated.contactPhone,
    contactWhatsapp: updated.contactWhatsapp,
    contactTelegram: updated.contactTelegram,
    contactMax: updated.contactMax,
  })
}
