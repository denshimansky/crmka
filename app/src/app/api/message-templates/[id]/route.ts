import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/** Правка и удаление шаблона сообщения. Удаление мягкое — как везде в проекте. */

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  sortOrder: z.number().int().optional(),
})

/** Шаблон своей организации (иначе 404 — чужой не подтверждаем). */
async function findOwn(tenantId: string, id: string) {
  return db.messageTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!(await findOwn(session.user.tenantId, id))) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const template = await db.messageTemplate.update({
    where: { id },
    data: parsed.data,
    select: { id: true, title: true, body: true, sortOrder: true, updatedAt: true },
  })

  return NextResponse.json(template)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!(await findOwn(session.user.tenantId, id))) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  }

  await db.messageTemplate.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
