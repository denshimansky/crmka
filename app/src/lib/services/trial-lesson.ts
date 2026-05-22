import { db } from "@/lib/db"
import type { TrialLesson } from "@prisma/client"

export type CreateTrialLessonInput = {
  clientId: string
  wardId: string
  groupId?: string
  directionId?: string
  instructorId?: string
  roomId?: string
  scheduledDate: string // YYYY-MM-DD
  startTime?: string // HH:MM
  durationMinutes?: number
  comment?: string
}

export type CreateTrialLessonResult =
  | { ok: true; trial: TrialLesson }
  | { ok: false; error: string; status: number }

type CreateTrialLessonOptions = {
  applicationId?: string
}

export async function createTrialLessonForClient(
  tenantId: string,
  userEmployeeId: string | null,
  input: CreateTrialLessonInput,
  options: CreateTrialLessonOptions = {},
): Promise<CreateTrialLessonResult> {
  const client = await db.client.findFirst({
    where: { id: input.clientId, tenantId, deletedAt: null },
    select: {
      id: true,
      clientStatus: true,
      funnelStatus: true,
      assignedTo: true,
      firstName: true,
      lastName: true,
    },
  })
  if (!client) return { ok: false, error: "Клиент не найден", status: 404 }
  const isActiveClient = client.clientStatus === "active"

  const ward = await db.ward.findFirst({
    where: { id: input.wardId, clientId: input.clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return { ok: false, error: "Подопечный не найден", status: 404 }

  const date = new Date(input.scheduledDate)

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

  if (input.groupId) {
    const group = await db.group.findFirst({
      where: { id: input.groupId, tenantId, deletedAt: null },
    })
    if (!group) return { ok: false, error: "Группа не найдена", status: 404 }

    const existingTrial = await db.trialLesson.findFirst({
      where: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        groupId: input.groupId,
        scheduledDate: date,
        status: "scheduled",
      },
    })
    if (existingTrial) {
      return {
        ok: false,
        error: "Этот подопечный уже записан на пробное в эту группу на эту дату",
        status: 409,
      }
    }

    const lesson = await db.lesson.findFirst({
      where: { tenantId, groupId: input.groupId, date, status: { not: "cancelled" } },
    })
    if (!lesson) {
      return {
        ok: false,
        error: "У группы нет занятия на эту дату. Выберите другую дату или режим «Без группы».",
        status: 400,
      }
    }
    lessonId = lesson.id
  } else {
    if (!input.directionId) {
      return { ok: false, error: "Для индивидуального пробного нужно направление", status: 400 }
    }
    if (!input.instructorId) {
      return { ok: false, error: "Для индивидуального пробного нужно выбрать педагога", status: 400 }
    }
    if (!input.startTime) {
      return { ok: false, error: "Для индивидуального пробного нужно время", status: 400 }
    }
    if (!input.roomId) {
      return { ok: false, error: "Для индивидуального пробного нужно выбрать кабинет", status: 400 }
    }

    const direction = await db.direction.findFirst({
      where: { id: input.directionId, tenantId, deletedAt: null },
      select: { id: true, lessonDuration: true },
    })
    if (!direction) return { ok: false, error: "Направление не найдено", status: 404 }

    const instructor = await db.employee.findFirst({
      where: { id: input.instructorId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!instructor) return { ok: false, error: "Педагог не найден", status: 404 }

    const room = await db.room.findFirst({
      where: { id: input.roomId, tenantId, deletedAt: null },
      select: { id: true },
    })
    if (!room) return { ok: false, error: "Кабинет не найден", status: 404 }
    storedRoomId = input.roomId

    const existingTrial = await db.trialLesson.findFirst({
      where: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        scheduledDate: date,
        startTime: input.startTime,
        status: "scheduled",
      },
    })
    if (existingTrial) {
      return { ok: false, error: "У подопечного уже есть пробное в это время", status: 409 }
    }

    storedDirectionId = input.directionId
    storedInstructorId = input.instructorId
    storedStartTime = input.startTime
    storedDuration = input.durationMinutes ?? direction.lessonDuration ?? 60
  }

  let reminderAssigneeId: string | null = client.assignedTo ?? userEmployeeId ?? null
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

  if (options.applicationId) {
    const application = await db.application.findFirst({
      where: {
        id: options.applicationId,
        tenantId,
        deletedAt: null,
        status: "active",
      },
      select: { id: true },
    })
    if (!application) {
      return { ok: false, error: "Заявка не найдена или уже обработана", status: 404 }
    }
  }

  const trial = await db.$transaction(async (tx) => {
    const created = await tx.trialLesson.create({
      data: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        groupId: input.groupId ?? null,
        lessonId,
        directionId: storedDirectionId,
        instructorId: storedInstructorId,
        roomId: storedRoomId,
        startTime: storedStartTime,
        durationMinutes: storedDuration,
        scheduledDate: date,
        instructorPayEnabled: defaultInstructorPay,
        comment: input.comment,
        createdBy: userEmployeeId ?? undefined,
      },
    })

    if (!isActiveClient) {
      await tx.client.update({
        where: { id: input.clientId },
        data: { funnelStatus: "trial_scheduled" },
      })
    }

    if (options.applicationId) {
      await tx.application.update({
        where: { id: options.applicationId },
        data: {
          status: "processed",
          processedToStatus: "trial",
          processedAt: new Date(),
          processedBy: userEmployeeId ?? undefined,
        },
      })
    }

    if (reminderAssigneeId) {
      const leadName = [client.lastName, client.firstName].filter(Boolean).join(" ") || "лид"
      await tx.task.create({
        data: {
          tenantId,
          title: `Напомнить про пробное: ${leadName} (${input.scheduledDate})`,
          type: "auto",
          autoTrigger: "trial_reminder",
          status: "pending",
          dueDate: taskDueDate,
          assignedTo: reminderAssigneeId,
          assignedBy: userEmployeeId ?? undefined,
          clientId: input.clientId,
        },
      })
    }

    return created
  })

  return { ok: true, trial }
}
