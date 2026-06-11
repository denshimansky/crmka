import { db } from "@/lib/db"
import { Prisma, type TrialLesson } from "@prisma/client"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"

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
      assignedTo: true,
      firstName: true,
      lastName: true,
    },
  })
  if (!client) return { ok: false, error: "Клиент не найден", status: 404 }

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
  // Направление пробного (из группы или индивидуальное) — по нему подбираем заявку,
  // если applicationId не передан явно.
  let effectiveDirectionId: string | null = null

  if (input.groupId) {
    const group = await db.group.findFirst({
      where: { id: input.groupId, tenantId, deletedAt: null },
    })
    if (!group) return { ok: false, error: "Группа не найдена", status: 404 }

    // Любое не-отменённое пробное (scheduled/attended/no_show) блокирует повторную
    // запись — иначе после отметки «Пришёл» проверка по `status=scheduled` пускает
    // создать дубль, и в карточке занятия один ребёнок появляется дважды.
    const existingTrial = await db.trialLesson.findFirst({
      where: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        groupId: input.groupId,
        scheduledDate: date,
        status: { in: ["scheduled", "attended", "no_show"] },
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
    effectiveDirectionId = group.directionId
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

    // Аналогично групповому: блокируем все активные (не cancelled) пробные.
    const existingTrial = await db.trialLesson.findFirst({
      where: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        scheduledDate: date,
        startTime: input.startTime,
        status: { in: ["scheduled", "attended", "no_show"] },
      },
    })
    if (existingTrial) {
      return { ok: false, error: "У подопечного уже есть пробное в это время", status: 409 }
    }

    storedDirectionId = input.directionId
    storedInstructorId = input.instructorId
    storedStartTime = input.startTime
    storedDuration = input.durationMinutes ?? direction.lessonDuration ?? 60
    effectiveDirectionId = input.directionId
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

  // Подбираем заявку, к которой привяжем пробное и которую переведём на этап
  // «Пробное» (заявка остаётся активной — воронка ведётся по заявке). Если
  // applicationId передан явно — используем его; иначе ищем активную заявку
  // подопечного на то же направление.
  let targetApplicationId: string | null = null
  if (options.applicationId) {
    const application = await db.application.findFirst({
      where: {
        id: options.applicationId,
        tenantId,
        wardId: input.wardId,
        deletedAt: null,
        status: "active",
      },
      select: { id: true },
    })
    if (!application) {
      return { ok: false, error: "Заявка не найдена или уже обработана", status: 404 }
    }
    targetApplicationId = application.id
  } else if (effectiveDirectionId) {
    const application = await db.application.findFirst({
      where: {
        tenantId,
        wardId: input.wardId,
        directionId: effectiveDirectionId,
        deletedAt: null,
        status: "active",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    targetApplicationId = application?.id ?? null
  }

  // Одна заявка — одно назначенное пробное: пока по заявке висит не отмеченное
  // (scheduled) пробное, второе не создаём. Перезапись после «Не пришёл» и
  // перенос даты на «Продажах» (cancel → create) проходят: no_show и cancelled
  // не блокируют.
  if (targetApplicationId) {
    const activeTrial = await db.trialLesson.findFirst({
      where: { tenantId, applicationId: targetApplicationId, status: "scheduled" },
      select: { scheduledDate: true },
    })
    if (activeTrial) {
      const d = activeTrial.scheduledDate
      const dateLabel = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
      return {
        ok: false,
        error: `По этой заявке уже назначено пробное на ${dateLabel}. Перенесите его («Продажи» → «Изменить») или удалите заявку из воронки.`,
        status: 409,
      }
    }
  }

  const trial = await db.$transaction(async (tx) => {
    const created = await tx.trialLesson.create({
      data: {
        tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        applicationId: targetApplicationId,
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

    // Заявку переводим на этап «Пробное», она остаётся активной (воронка по заявке).
    // Зеркало Ward.salesStage пересчитаем как максимум по активным заявкам.
    if (targetApplicationId) {
      await tx.application.update({
        where: { id: targetApplicationId },
        data: { stage: "trial_scheduled" },
      })
    }
    await recomputeWardSalesStage(tx, tenantId, input.wardId)

    // Если у клиента ещё нет ответственного — закрепляем за тем, кто записал
    // пробное. Не перезаписываем уже назначенного, чтобы не отбирать клиентов.
    if (!client.assignedTo && userEmployeeId) {
      await tx.client.update({
        where: { id: input.clientId },
        data: { assignedTo: userEmployeeId },
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
  }).catch((e: unknown) => {
    // Частичный уникальный индекс trial_lessons_application_scheduled_uniq:
    // проигравший гонку параллельный запрос получает тот же 409, что и обычный дубль.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null
    throw e
  })

  if (!trial) {
    return {
      ok: false,
      error:
        "По этой заявке уже назначено пробное. Перенесите его («Продажи» → «Изменить») или удалите заявку из воронки.",
      status: 409,
    }
  }

  return { ok: true, trial }
}
