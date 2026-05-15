import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// Два режима записи пробного:
//   1. С группой (groupId задан) — дата должна совпадать с расписанием группы;
//      пробное цепляется к существующему занятию группы.
//   2. Без группы (индивидуальный) — нужны direction, startTime, durationMinutes.
//      Lesson не создаётся; время хранится на самом TrialLesson.
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
  const data = parsed.data
  const tenantId = session.user.tenantId

  // Лид существует и принадлежит организации
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId, deletedAt: null },
    select: {
      id: true,
      clientStatus: true,
      funnelStatus: true,
      assignedTo: true,
      firstName: true,
      lastName: true,
    },
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

  const date = new Date(data.scheduledDate)

  // Настройка организации — оплачиваются ли пробные инструктору
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { payForTrialLessons: true },
  })
  const defaultInstructorPay = !!org?.payForTrialLessons

  let lessonId: string | null = null
  let storedDirectionId: string | null = null
  let storedInstructorId: string | null = null
  let storedRoomId: string | null = null
  let storedStartTime: string | null = null
  let storedDuration: number | null = null

  if (data.groupId) {
    // === Режим 1: пробник внутри группы ===
    const group = await db.group.findFirst({
      where: { id: data.groupId, tenantId, deletedAt: null },
    })
    if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

    // Защита от дубля
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
      return NextResponse.json(
        { error: "Этот подопечный уже записан на пробное в эту группу на эту дату" },
        { status: 409 }
      )
    }

    // У группы должно быть занятие на эту дату — иначе отказ.
    // Новое занятие НЕ создаём (это и был баг — генерация лишних занятий).
    const lesson = await db.lesson.findFirst({
      where: { tenantId, groupId: data.groupId, date, status: { not: "cancelled" } },
    })
    if (!lesson) {
      return NextResponse.json(
        { error: "У группы нет занятия на эту дату. Выберите другую дату или режим «Без группы»." },
        { status: 400 }
      )
    }
    lessonId = lesson.id
  } else {
    // === Режим 2: индивидуальный пробник ===
    if (!data.directionId) {
      return NextResponse.json({ error: "Для индивидуального пробного нужно направление" }, { status: 400 })
    }
    if (!data.instructorId) {
      return NextResponse.json({ error: "Для индивидуального пробного нужно выбрать педагога" }, { status: 400 })
    }
    if (!data.startTime) {
      return NextResponse.json({ error: "Для индивидуального пробного нужно время" }, { status: 400 })
    }

    // Направление существует
    const direction = await db.direction.findFirst({
      where: { id: data.directionId, tenantId, deletedAt: null },
      select: { id: true, lessonDuration: true },
    })
    if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

    // Инструктор существует
    const instructor = await db.employee.findFirst({
      where: { id: data.instructorId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!instructor) return NextResponse.json({ error: "Педагог не найден" }, { status: 404 })

    // Кабинет (опционально, если указан — должен принадлежать организации)
    if (data.roomId) {
      const room = await db.room.findFirst({
        where: { id: data.roomId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!room) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 })
      storedRoomId = data.roomId
    }

    // Защита от дубля по дате+времени
    const existingTrial = await db.trialLesson.findFirst({
      where: {
        tenantId,
        clientId: data.clientId,
        wardId: data.wardId,
        scheduledDate: date,
        startTime: data.startTime,
        status: "scheduled",
      },
    })
    if (existingTrial) {
      return NextResponse.json(
        { error: "У подопечного уже есть пробное в это время" },
        { status: 409 }
      )
    }

    storedDirectionId = data.directionId
    storedInstructorId = data.instructorId
    storedStartTime = data.startTime
    storedDuration = data.durationMinutes ?? direction.lessonDuration ?? 60
  }

  // Исполнитель автозадачи-напоминания
  let reminderAssigneeId: string | null = client.assignedTo ?? session.user.employeeId ?? null
  if (!reminderAssigneeId) {
    const fallback = await db.employee.findFirst({
      where: { tenantId, deletedAt: null, isActive: true, role: { in: ["owner", "manager", "admin"] } },
      select: { id: true },
      orderBy: { role: "asc" },
    })
    reminderAssigneeId = fallback?.id ?? null
  }

  const reminderDate = new Date(date)
  reminderDate.setDate(reminderDate.getDate() - 1)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const taskDueDate = reminderDate < todayStart ? todayStart : reminderDate

  const trial = await db.$transaction(async (tx) => {
    const created = await tx.trialLesson.create({
      data: {
        tenantId,
        clientId: data.clientId,
        wardId: data.wardId,
        groupId: data.groupId ?? null,
        lessonId,
        directionId: storedDirectionId,
        instructorId: storedInstructorId,
        roomId: storedRoomId,
        startTime: storedStartTime,
        durationMinutes: storedDuration,
        scheduledDate: date,
        instructorPayEnabled: defaultInstructorPay,
        comment: data.comment,
        createdBy: session.user.employeeId,
      },
    })

    await tx.client.update({
      where: { id: data.clientId },
      data: { funnelStatus: "trial_scheduled" },
    })

    if (reminderAssigneeId) {
      const leadName = [client.lastName, client.firstName].filter(Boolean).join(" ") || "лид"
      await tx.task.create({
        data: {
          tenantId,
          title: `Напомнить про пробное: ${leadName} (${data.scheduledDate})`,
          type: "auto",
          autoTrigger: "trial_reminder",
          status: "pending",
          dueDate: taskDueDate,
          assignedTo: reminderAssigneeId,
          assignedBy: session.user.employeeId ?? undefined,
          clientId: data.clientId,
        },
      })
    }

    return created
  })

  return NextResponse.json(trial, { status: 201 })
}
