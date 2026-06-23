import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createWardSchema = z.object({
  firstName: z.string().min(1, "Имя подопечного обязательно"),
  lastName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  birthDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  notes: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// Список подопечных клиента — для диалога «Создать заявку» с поиском по клиенту:
// после выбора клиента подгружаем его подопечных, чтобы указать wardId в заявке.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const client = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const wards = await db.ward.findMany({
    where: { clientId: id, tenantId: session.user.tenantId },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(wards)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = createWardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем что клиент наш
  const client = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Новый подопечный создаётся вне воронки (salesStage='none' по умолчанию).
  // Воронка теперь ведётся по заявкам: ребёнок появится в Продажах, когда по нему
  // заведут заявку (кнопка «+ Заявка»). Так же ведут себя быстрое создание клиента
  // и импорт — не плодим строки в «Заявке» без самой заявки.
  const ward = await db.ward.create({
    data: {
      tenantId: session.user.tenantId,
      clientId: id,
      firstName: data.firstName,
      lastName: data.lastName,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      notes: data.notes,
    },
  })

  return NextResponse.json(ward, { status: 201 })
}
