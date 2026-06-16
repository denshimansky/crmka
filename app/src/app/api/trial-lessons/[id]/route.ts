import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { resolveRate } from "@/lib/salary/resolve-rate"
import { calcPay } from "@/lib/salary/calc-pay"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { Prisma } from "@prisma/client"
import { z } from "zod"

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

// Расчёт ставки инструктора за пробное через единые утилиты.
// Для пробных currentChargeAmount=0 (пробное не списывает с абонемента),
// поэтому для percent_of_payments выйдет 0 — это совпадает со старым поведением.
async function computeTrialPay(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    lessonId: string
    groupId: string
    clientId: string
    instructorId: string
    directionId: string
    instructorPayEnabled: boolean
  }
): Promise<Prisma.Decimal> {
  if (!args.instructorPayEnabled) return new Prisma.Decimal(0)

  const rate = await resolveRate(tx, {
    tenantId: args.tenantId,
    groupId: args.groupId,
    employeeId: args.instructorId,
    directionId: args.directionId,
  })
  if (!rate) return new Prisma.Decimal(0)

  return calcPay(tx, {
    rate,
    lessonId: args.lessonId,
    tenantId: args.tenantId,
    currentClientId: args.clientId,
    currentChargeAmount: 0,
  })
}

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
      ward: { select: { id: true, salesStage: true } },
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
    if (!trial.lesson) return t

    const lessonInstructorId =
      trial.lesson.substituteInstructorId || trial.lesson.instructorId

    if (effectiveStatus === "attended") {
      const payAmount = presentType
        ? await computeTrialPay(tx, {
            tenantId,
            lessonId: trial.lesson.id,
            groupId: trial.lesson.groupId,
            clientId: trial.clientId,
            instructorId: lessonInstructorId,
            directionId: trial.lesson.group.directionId,
            instructorPayEnabled: effectivePay,
          })
        : new Prisma.Decimal(0)

      if (presentType) {
        const existingAtt = await tx.attendance.findFirst({
          where: {
            tenantId,
            lessonId: trial.lesson.id,
            clientId: trial.clientId,
            wardId: trial.wardId,
            isTrial: true,
          },
        })
        if (existingAtt) {
          await tx.attendance.update({
            where: { id: existingAtt.id },
            data: {
              attendanceTypeId: presentType.id,
              chargeAmount: new Prisma.Decimal(0),
              instructorPayAmount: payAmount,
              instructorPayEnabled: effectivePay,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        } else {
          await tx.attendance.create({
            data: {
              tenantId,
              lessonId: trial.lesson.id,
              clientId: trial.clientId,
              wardId: trial.wardId,
              attendanceTypeId: presentType.id,
              chargeAmount: new Prisma.Decimal(0),
              instructorPayAmount: payAmount,
              instructorPayEnabled: effectivePay,
              isTrial: true,
              markedBy: session.user.employeeId ?? undefined,
              markedAt: now,
            },
          })
        }
      }
    } else if (
      effectiveStatus === "no_show" ||
      effectiveStatus === "cancelled" ||
      effectiveStatus === "scheduled"
    ) {
      // scheduled здесь означает «сброс отметки» — удаляем созданную ранее Attendance,
      // если она есть. Откат этапа заявки trial_attended → trial_scheduled выполнен выше.
      await tx.attendance.deleteMany({
        where: {
          tenantId,
          lessonId: trial.lesson.id,
          clientId: trial.clientId,
          wardId: trial.wardId,
          isTrial: true,
        },
      })
    }

    return t
  })

  return NextResponse.json(updated)
}
