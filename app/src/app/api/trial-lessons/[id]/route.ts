import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { computeTrialPay } from "@/lib/salary/trial-pay"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import {
  createTrialHolderLesson,
  setTrialHolderLessonStatus,
} from "@/lib/services/trial-holder-lesson"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { computeTrialCharge } from "@/lib/services/trial-charge"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"

const updateSchema = z
  .object({
    status: z.enum(["scheduled", "attended", "no_show", "cancelled"]).optional(),
    instructorPayEnabled: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.instructorPayEnabled !== undefined ||
      d.confirmed !== undefined,
    { message: "Нечего обновлять" },
  )

// PATCH /api/trial-lessons/[id] — изменить статус, флаг оплаты инструктору
// или отметку «подтвердили пробное» (confirmed — без побочных эффектов)
// attended → создаёт Attendance(isTrial=true), переводит Ward.salesStage в trial_attended (если ещё trial_scheduled)
// scheduled (сброс отметки) → удаляет Attendance + откатывает заявку trial_attended → trial_scheduled
// no_show / cancelled → удаляет Attendance + закрывает автозадачу-напоминание
// Изменение instructorPayEnabled — обновляет TrialLesson и (если уже attended) пересчитывает Attendance
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Роль «только чтение» не отмечает (UI это уже скрывает; защищаем API).
  if ((session.user as any).role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { status, instructorPayEnabled, confirmed } = parsed.data
  const tenantId = session.user.tenantId

  const trial = await db.trialLesson.findFirst({
    where: { id, tenantId },
    include: {
      ward: { select: { id: true, salesStage: true, firstName: true, lastName: true } },
      client: { select: { firstName: true, lastName: true } },
      // Филиал кабинета — для скрытой группы-держателя, если занятие придётся
      // досоздавать (индивидуальные пробные, записанные до этого механизма).
      room: { select: { branchId: true } },
      lesson: {
        select: {
          id: true,
          groupId: true,
          instructorId: true,
          substituteInstructorId: true,
          group: { select: { directionId: true } },
        },
      },
    },
  })
  if (!trial) return NextResponse.json({ error: "Пробное не найдено" }, { status: 404 })

  const now = new Date()
  const effectiveStatus = status ?? trial.status
  const effectivePay = instructorPayEnabled ?? trial.instructorPayEnabled

  // present attendance type для записи явки
  const presentType = await db.attendanceType.findFirst({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      code: "present",
      isActive: true,
    },
  })

  // Итог отметки для клиента API: занятие пробного (у индивидуального оно
  // могло быть создано прямо сейчас) и начисленная инструктору сумма — UI
  // показывает её сразу, не дожидаясь перезагрузки страницы.
  let resolvedLessonId: string | null = trial.lessonId
  let accruedPay = 0

  const updated = await db.$transaction(async (tx) => {
    const t = await tx.trialLesson.update({
      where: { id },
      data: {
        ...(status !== undefined && {
          status,
          attendedAt: status === "attended" ? now : null,
        }),
        ...(instructorPayEnabled !== undefined && { instructorPayEnabled }),
        ...(confirmed !== undefined && { confirmed }),
      },
    })

    // --- Эффекты, не зависящие от наличия Lesson (работают и для индивидуальных) ---

    // attended → переводим заявку на этап «Прошёл пробное», если она ещё на «Пробное».
    // Если заявка уже двинута в awaiting_payment (вручную) — не откатываем (stage-фильтр).
    if (status === "attended" && trial.applicationId) {
      await tx.application.updateMany({
        where: {
          id: trial.applicationId,
          tenantId,
          status: "active",
          stage: "trial_scheduled",
        },
        data: { stage: "trial_attended" },
      })
    }

    // Закрыть открытую автозадачу-напоминание при смене статуса
    if (status !== undefined && status !== "scheduled") {
      await tx.task.updateMany({
        where: {
          tenantId,
          clientId: trial.clientId,
          autoTrigger: "trial_reminder",
          status: "pending",
          deletedAt: null,
        },
        data: {
          status: "completed",
          completedAt: now,
          completedBy: session.user.employeeId ?? undefined,
        },
      })
    }

    // Сброс отметки («Не отмечен») откатывает заявку с «Прошёл пробное»
    // обратно на «Пробное записано» — если на этой же заявке не осталось
    // других отмеченных («attended») пробных. awaiting_payment и закрытые
    // заявки не трогаем (stage-фильтр): их уже двинули дальше вручную.
    if (status === "scheduled" && trial.applicationId) {
      const otherAttendedTrials = await tx.trialLesson.count({
        where: {
          tenantId,
          applicationId: trial.applicationId,
          id: { not: id },
          status: "attended",
        },
      })
      if (otherAttendedTrials === 0) {
        await tx.application.updateMany({
          where: {
            id: trial.applicationId,
            tenantId,
            status: "active",
            stage: "trial_attended",
          },
          data: { stage: "trial_scheduled" },
        })
      }
    }

    // Отмена пробного возвращает заявку на этап «Заявка» (из «Пробное»/«Прошёл пробное»).
    // Если у этой же заявки есть другое не-отменённое пробное — этап не откатываем.
    // awaiting_payment и закрытые заявки не трогаем (stage-фильтр).
    if (status === "cancelled" && trial.applicationId) {
      const otherActiveTrials = await tx.trialLesson.count({
        where: {
          tenantId,
          applicationId: trial.applicationId,
          id: { not: id },
          status: { not: "cancelled" },
        },
      })
      if (otherActiveTrials === 0) {
        await tx.application.updateMany({
          where: {
            id: trial.applicationId,
            tenantId,
            status: "active",
            stage: { in: ["trial_scheduled", "trial_attended"] },
          },
          data: { stage: "application" },
        })
      }
    }

    // Пересчитываем зеркало Ward.salesStage по активным заявкам после смены этапа.
    if (status !== undefined && trial.wardId) {
      await recomputeWardSalesStage(tx, tenantId, trial.wardId, now)
    }

    // Каскад на уведомления: если триал переходит в терминальный статус
    // и у клиента не осталось будущих запланированных пробных — убираем
    // напоминания trial_reminder для этого клиента (они стали фантомными).
    if (status === "cancelled" || status === "attended" || status === "no_show") {
      const todayMidnight = new Date()
      todayMidnight.setHours(0, 0, 0, 0)
      const upcomingTrials = await tx.trialLesson.count({
        where: {
          tenantId,
          clientId: trial.clientId,
          id: { not: id },
          status: "scheduled",
          scheduledDate: { gte: todayMidnight },
        },
      })
      if (upcomingTrials === 0) {
        await tx.notification.deleteMany({
          where: {
            tenantId,
            type: "trial_reminder",
            entityType: "Client",
            entityId: trial.clientId,
          },
        })
      }
    }

    // --- Управление Attendance только для пробных, привязанных к Lesson ---
    // Индивидуальное пробное (без группы) держит собственное техническое
    // занятие — оно создаётся вместе с пробным. У записей, сделанных до
    // появления этого механизма, занятия нет: заводим его лениво при первой
    // отметке, иначе за проведённое пробное педагогу начислить нечего
    // (вся ЗП считается по Attendance занятия).
    let lesson = trial.lesson
    if (
      !lesson &&
      effectiveStatus === "attended" &&
      trial.groupId === null &&
      trial.directionId &&
      trial.instructorId &&
      trial.roomId &&
      trial.room &&
      trial.startTime
    ) {
      const holder = await createTrialHolderLesson(tx, {
        tenantId,
        directionId: trial.directionId,
        branchId: trial.room.branchId,
        roomId: trial.roomId,
        instructorId: trial.instructorId,
        date: trial.scheduledDate,
        startTime: trial.startTime,
        durationMinutes: trial.durationMinutes ?? 60,
        label:
          [trial.ward?.lastName, trial.ward?.firstName].filter(Boolean).join(" ") ||
          [trial.client.lastName, trial.client.firstName].filter(Boolean).join(" ") ||
          "лид",
      })
      await tx.trialLesson.update({
        where: { id },
        data: { lessonId: holder.lessonId },
      })
      lesson = {
        id: holder.lessonId,
        groupId: holder.groupId,
        instructorId: trial.instructorId,
        substituteInstructorId: null,
        group: { directionId: trial.directionId },
      }
    }
    if (!lesson) return t
    resolvedLessonId = lesson.id

    // Статус занятия-держателя идёт следом за пробным: отменённое пробное не
    // должно держать кабинет (findRoomOccupant считает занятие занятостью),
    // возвращённое в работу — снова занимает свой слот. Занятия настоящих
    // групп функция не трогает (фильтр по group.isTrialHolder).
    if (status === "cancelled") {
      await setTrialHolderLessonStatus(tx, tenantId, lesson.id, "cancelled")
    } else if (status !== undefined) {
      await setTrialHolderLessonStatus(tx, tenantId, lesson.id, "scheduled")
    }

    const lessonInstructorId =
      lesson.substituteInstructorId || lesson.instructorId

    if (effectiveStatus === "attended") {
      // Attendance пробного общая для дублей TrialLesson на одном занятии (ключ —
      // lesson+client+ward, не trialId). Оплату инструктору не понижаем, если у
      // другого attended-дубля она включена: иначе отметка второго пробного с
      // выключенной оплатой затёрла бы уже начисленную ЗП первого.
      const otherAttendedPaid = await tx.trialLesson.count({
        where: {
          tenantId,
          id: { not: id },
          lessonId: lesson.id,
          clientId: trial.clientId,
          wardId: trial.wardId,
          status: "attended",
          instructorPayEnabled: true,
        },
      })
      const attendancePayEnabled = effectivePay || otherAttendedPaid > 0
      const payAmount = presentType
        ? await computeTrialPay(tx, {
            tenantId,
            lessonId: lesson.id,
            groupId: lesson.groupId,
            clientId: trial.clientId,
            instructorId: lessonInstructorId,
            directionId: lesson.group.directionId,
            instructorPayEnabled: attendancePayEnabled,
            atDate: trial.scheduledDate,
          })
        : new Prisma.Decimal(0)
      accruedPay = attendancePayEnabled ? Number(payAmount) : 0

      if (presentType) {
        // Сумма списания за пробное — по галке «Бесплатное пробное» направления.
        const direction = await tx.direction.findUnique({
          where: { id: lesson.group.directionId },
          select: { trialFree: true, trialPrice: true },
        })
        const newCharge = direction ? computeTrialCharge(direction) : new Prisma.Decimal(0)

        const existingAtt = await tx.attendance.findFirst({
          where: {
            tenantId,
            lessonId: lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
        })
        const prevCharge = existingAtt
          ? new Prisma.Decimal(existingAtt.chargeAmount)
          : new Prisma.Decimal(0)
        // Деньги двигаем только при ЯВНОЙ отметке «Был» (status==="attended").
        // Переключение оплаты инструктору / confirmed (status undefined) не должно
        // ни списывать, ни возвращать — и не ретро-списывает легаси-пробные (0₽)
        // на платном направлении.
        const settle = status === "attended"
        const targetCharge = settle ? newCharge : prevCharge
        const chargeChanged = settle && !prevCharge.equals(newCharge)

        // Откат прежнего списания (при повторной отметке/смене цены).
        if (existingAtt && chargeChanged && prevCharge.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: prevCharge,
            type: "attendance_revert",
            refs: { lessonId: lesson.id, attendanceId: existingAtt.id, directionId: lesson.group.directionId },
            createdBy: session.user.employeeId ?? undefined,
          })
        }

        let att
        if (existingAtt) {
          att = await tx.attendance.update({
            where: { id: existingAtt.id },
            data: {
              attendanceTypeId: presentType.id,
              chargeAmount: targetCharge,
              instructorPayAmount: payAmount,
              instructorPayEnabled: attendancePayEnabled,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        } else {
          att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId: lesson.id,
              clientId: trial.clientId,
              wardId: trial.wardId,
              attendanceTypeId: presentType.id,
              chargeAmount: targetCharge,
              instructorPayAmount: payAmount,
              instructorPayEnabled: attendancePayEnabled,
              isTrial: true,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        }

        // Списание нового пробного с баланса родителя (в минус = долг).
        if (chargeChanged && newCharge.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: newCharge.negated(),
            type: "trial_charge",
            refs: { lessonId: lesson.id, attendanceId: att.id, directionId: lesson.group.directionId },
            comment: "Пробное занятие",
            createdBy: session.user.employeeId ?? undefined,
          })
        }

        // firstPaidLessonDate — агрегат для отчётов/конверсии (statusflip НЕ делаем,
        // «оставить в воронке»). Пересчёт по факту платных посещений + заявок.
        await recomputeClientFirstPaidLessonDate(tx, tenantId, trial.clientId)
      }
    } else if (
      effectiveStatus === "no_show" ||
      effectiveStatus === "cancelled" ||
      effectiveStatus === "scheduled"
    ) {
      // scheduled здесь означает «сброс отметки» — удаляем созданную ранее Attendance,
      // если она есть. Откат этапа заявки trial_attended → trial_scheduled выполнен выше.
      // Attendance пробного ключуется по (lesson, client, ward), а не по trialId:
      // при дублях TrialLesson одного лида на одном занятии (перенос занятия со
      // старой scheduledDate, слияние клиентов, легаси) сброс одного пробного не
      // должен стирать явку, созданную другим attended-пробным, — иначе тихо
      // пропадают явка и ЗП инструктора при зелёном статусе в сетке.
      const otherAttendedSameLesson = await tx.trialLesson.findMany({
        where: {
          tenantId,
          id: { not: id },
          lessonId: lesson.id,
          clientId: trial.clientId,
          wardId: trial.wardId,
          status: "attended",
        },
        select: { instructorPayEnabled: true },
      })
      if (otherAttendedSameLesson.length === 0) {
        // Возврат платного пробного на баланс перед удалением явки.
        const toDelete = await tx.attendance.findFirst({
          where: { tenantId, lessonId: lesson.id, clientId: trial.clientId, wardId: trial.wardId, isTrial: true },
        })
        if (toDelete && new Prisma.Decimal(toDelete.chargeAmount).gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: trial.clientId,
            delta: new Prisma.Decimal(toDelete.chargeAmount),
            type: "attendance_revert",
            refs: { lessonId: lesson.id, directionId: lesson.group.directionId },
            createdBy: session.user.employeeId ?? undefined,
          })
        }
        await tx.attendance.deleteMany({
          where: {
            tenantId,
            lessonId: lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
        })
        await recomputeClientFirstPaidLessonDate(tx, tenantId, trial.clientId)
      } else if (presentType) {
        // Явка принадлежит выжившему attended-дублю — не удаляем, а пере-
        // синхронизируем по нему: сбрасываемый мог ранее затереть общую строку
        // своими оплатой/суммой (или наоборот — оставить свою завышенную).
        const survivorPayEnabled = otherAttendedSameLesson.some((s) => s.instructorPayEnabled)
        const survivorPay = await computeTrialPay(tx, {
          tenantId,
          lessonId: lesson.id,
          groupId: lesson.groupId,
          clientId: trial.clientId,
          instructorId: lessonInstructorId,
          directionId: lesson.group.directionId,
          instructorPayEnabled: survivorPayEnabled,
          atDate: trial.scheduledDate,
        })
        // Списание принадлежит выжившему платному пробному — сохраняем его сумму,
        // иначе баланс и chargeAmount разъедутся (фантомный долг / двойное списание).
        const survivorDirection = await tx.direction.findUnique({
          where: { id: lesson.group.directionId },
          select: { trialFree: true, trialPrice: true },
        })
        const survivorCharge = survivorDirection
          ? computeTrialCharge(survivorDirection)
          : new Prisma.Decimal(0)
        await tx.attendance.updateMany({
          where: {
            tenantId,
            lessonId: lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
          data: {
            attendanceTypeId: presentType.id,
            chargeAmount: survivorCharge,
            instructorPayAmount: survivorPay,
            instructorPayEnabled: survivorPayEnabled,
          },
        })
      }
    }

    return t
  })

  return NextResponse.json({
    ...updated,
    lessonId: resolvedLessonId,
    instructorPayAmount: accruedPay,
  })
}
