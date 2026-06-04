import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { z } from "zod"
import { createTrialLessonForClient } from "@/lib/services/trial-lesson"
import { db } from "@/lib/db"

// Два режима записи пробного:
//   1. С группой (groupId задан) — дата должна совпадать с расписанием группы.
//   2. Без группы (индивидуальный) — direction, startTime, durationMinutes.
const createSchema = z.object({
  clientId: z.string().uuid(),
  wardId: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  directionId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Время формата HH:MM").optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  comment: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  // Клиенты в архиве/ЧС не могут записываться на пробное.
  const client = await db.client.findFirst({
    where: { id: parsed.data.clientId, tenantId: session.user.tenantId, deletedAt: null },
    select: { funnelStatus: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  }
  if (client.funnelStatus === "archived" || client.funnelStatus === "blacklisted") {
    return NextResponse.json(
      { error: "Клиент в архиве/ЧС — снимите статус, чтобы записать на пробное." },
      { status: 403 },
    )
  }

  // У ребёнка должна быть открытая заявка ИЛИ Ward.salesStage='application'.
  // Без этого условия пробное создаётся «из воздуха», что ломает воронку.
  // Создание пробного через обработку заявки (`/api/applications/[id]/process`)
  // идёт мимо этой проверки — там заявка по определению есть.
  const ward = await db.ward.findFirst({
    where: { id: parsed.data.wardId, tenantId: session.user.tenantId },
    select: { salesStage: true },
  })
  if (!ward) {
    return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })
  }
  if (ward.salesStage !== "application") {
    const hasActiveApplication = await db.application.findFirst({
      where: {
        tenantId: session.user.tenantId,
        wardId: parsed.data.wardId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!hasActiveApplication) {
      return NextResponse.json(
        { error: "У ребёнка нет открытой заявки. Создайте заявку перед записью на пробное." },
        { status: 400 },
      )
    }
  }

  const result = await createTrialLessonForClient(
    session.user.tenantId,
    session.user.employeeId ?? null,
    parsed.data,
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result.trial, { status: 201 })
}
