import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * Шаблоны сообщений для расширения-панели (docs/messenger-extension.md, Фаза 3).
 * Управляются в CRM: «Настройки → Шаблоны сообщений». Панель берёт их через
 * /api/ext/templates уже с подставленными данными клиента.
 */

const bodySchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(120),
  body: z.string().trim().min(1, "Текст шаблона обязателен").max(4000),
  sortOrder: z.number().int().default(0),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const templates = await db.messageTemplate.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true, title: true, body: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  })

  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const template = await db.messageTemplate.create({
    data: {
      tenantId: session.user.tenantId,
      title: parsed.data.title,
      body: parsed.data.body,
      sortOrder: parsed.data.sortOrder,
      createdBy: session.user.employeeId,
      // Канал пока не выбираем: единственный работающий адаптер — Telegram, а
      // делить шаблоны по каналам, когда канал один, значит плодить пустой
      // выбор. Поле в модели есть, включим вместе со вторым мессенджером.
      channel: null,
    },
    select: { id: true, title: true, body: true, sortOrder: true, updatedAt: true },
  })

  return NextResponse.json(template, { status: 201 })
}
