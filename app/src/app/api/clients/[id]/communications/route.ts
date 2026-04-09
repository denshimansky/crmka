import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createNoteSchema = z.object({
  content: z.string().min(1, "Текст заметки обязателен"),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  // Проверяем что клиент принадлежит тенанту
  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100)
  const offset = Number(searchParams.get("offset")) || 0

  const [communications, total] = await Promise.all([
    db.communication.findMany({
      where: { tenantId, clientId: id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.communication.count({ where: { tenantId, clientId: id } }),
  ])

  return NextResponse.json({ communications, total })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  // Проверяем что клиент принадлежит тенанту
  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const body = await req.json()
  const parsed = createNoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const communication = await db.communication.create({
    data: {
      tenantId,
      clientId: id,
      type: "note",
      channel: "internal",
      direction: "internal",
      content: parsed.data.content,
      employeeId: employeeId || undefined,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(communication, { status: 201 })
}
