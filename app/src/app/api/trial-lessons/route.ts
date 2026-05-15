import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  clientId: z.string().uuid(),
  wardId: z.string().uuid(),
  groupId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
  comment: z.string().optional(),
})

// POST /api/trial-lessons — записать лида на пробное занятие
// Создаёт/находит занятие в расписании группы, привязывает к нему TrialLesson,
// переводит лида в статус trial_scheduled.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data
  const tenantId = session.user.tenantId

  // Лид существует и принадлежит организации
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId, deletedAt: null },
    select: { id: true, clientStatus: true, funnelStatus: true },
  })
  if (!client) return NextResponse.json({ error: "Лид не найден" }, { status: 404 })
  if (client.clientStatus === "active") {
    return NextResponse.json({ error: "Это уже активный клиент, а не лид" }, { status: 400 })
  }

  // Подопечный существует и принадлежит этому лиду
  const ward = await db.ward.findFirst({
    where: { id: data.wardId, clientId: data.clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  // Группа существует
  const group = await db.group.findFirst({
    where: { id: data.groupId, tenantId, deletedAt: null },
    include: { templates: { where: { effectiveTo: null } } },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const date = new Date(data.scheduledDate)

  // Уже есть пробное на эту дату в этой группе у этого подопечного?
  const existingTrial = await db.trialLesson.findFirst({
    where: {
      tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      groupId: data.groupId,
      scheduledDate: date,
      status: "scheduled",
    },
  })
  if (existingTrial) {
    return NextResponse.json({ error: "Этот подопечный уже записан на пробное в эту группу на эту дату" }, { status: 409 })
  }

  // Находим существующее занятие группы на эту дату или создаём новое
  let lesson = await db.lesson.findFirst({
    where: { tenantId, groupId: data.groupId, date },
  })

  if (!lesson) {
    // Время и длительность — из шаблона группы для соответствующего дня недели,
    // либо первого шаблона, либо дефолтных значений.
    const jsDay = date.getDay() // 0=вс, 1=пн...
    const templateDay = jsDay === 0 ? 6 : jsDay - 1
    const template =
      group.templates.find((t) => t.dayOfWeek === templateDay) ||
      group.templates[0]

    const startTime = template?.startTime || "10:00"
    const durationMinutes = template?.durationMinutes || 60

    lesson = await db.lesson.create({
      data: {
        tenantId,
        groupId: data.groupId,
        date,
        startTime,
        durationMinutes,
        instructorId: group.instructorId,
        isTrial: true,
        status: "scheduled",
      },
    })
  }

  // Создаём пробное + меняем статус лида атомарно
  const trial = await db.$transaction(async (tx) => {
    const created = await tx.trialLesson.create({
      data: {
        tenantId,
        clientId: data.clientId,
        wardId: data.wardId,
        groupId: data.groupId,
        lessonId: lesson!.id,
        scheduledDate: date,
        comment: data.comment,
        createdBy: session.user.employeeId,
      },
    })

    await tx.client.update({
      where: { id: data.clientId },
      data: { funnelStatus: "trial_scheduled" },
    })

    return created
  })

  return NextResponse.json(trial, { status: 201 })
}
