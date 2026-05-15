import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const updateSchema = z
  .object({
    status: z.enum(["scheduled", "attended", "no_show", "cancelled"]).optional(),
    instructorPayEnabled: z.boolean().optional(),
  })
  .refine((d) => d.status !== undefined || d.instructorPayEnabled !== undefined, {
    message: "Нечего обновлять",
  })

// Расчёт ставки инструктора за пробное — копирует логику обычной отметки
async function computeTrialPay(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    lessonId: string
    instructorId: string
    directionId: string
    instructorPayEnabled: boolean
  }
): Promise<Prisma.Decimal> {
  if (!args.instructorPayEnabled) return new Prisma.Decimal(0)

  const salaryRate = await tx.salaryRate.findFirst({
    where: {
      tenantId: args.tenantId,
      employeeId: args.instructorId,
      directionId: args.directionId,
    },
  })
  if (!salaryRate) return new Prisma.Decimal(0)

  if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
    return salaryRate.ratePerStudent
  }
  if (salaryRate.scheme === "fixed_plus_per_student" && salaryRate.ratePerStudent) {
    return salaryRate.ratePerStudent
  }
  if (salaryRate.scheme === "per_lesson" && salaryRate.ratePerLesson) {
    // per_lesson — оплата раз за занятие. Если уже есть оплачиваемые посещения — не дублируем.
    const existingCount = await tx.attendance.count({
      where: {
        lessonId: args.lessonId,
        attendanceType: { paysInstructor: true },
        instructorPayEnabled: true,
      },
    })
    if (existingCount === 0) return salaryRate.ratePerLesson
  }
  return new Prisma.Decimal(0)
}

// PATCH /api/trial-lessons/[id] — изменить статус или флаг оплаты инструктору
// attended → создаёт Attendance(isTrial=true), переводит лида в trial_attended (если ещё trial_scheduled)
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
  const { status, instructorPayEnabled } = parsed.data
  const tenantId = session.user.tenantId

  const trial = await db.trialLesson.findFirst({
    where: { id, tenantId },
    include: {
      client: { select: { funnelStatus: true } },
      lesson: {
        select: {
          id: true,
          instructorId: true,
          substituteInstructorId: true,
          group: { select: { directionId: true } },
        },
      },
    },
  })
  if (!trial) return NextResponse.json({ error: "Пробное не найдено" }, { status: 404 })

  if (status === "scheduled" && trial.status !== "scheduled") {
    return NextResponse.json({ error: "Нельзя вернуть пробное в статус 'scheduled' после отметки" }, { status: 400 })
  }

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
      },
    })

    // --- Эффекты, не зависящие от наличия Lesson (работают и для индивидуальных) ---

    // attended → перевести лида в trial_attended, если он ещё в trial_scheduled
    if (status === "attended" && trial.client?.funnelStatus === "trial_scheduled") {
      await tx.client.update({
        where: { id: trial.clientId },
        data: { funnelStatus: "trial_attended" },
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

    // --- Управление Attendance только для пробных, привязанных к Lesson ---
    if (!trial.lesson) return t

    const lessonInstructorId =
      trial.lesson.substituteInstructorId || trial.lesson.instructorId

    if (effectiveStatus === "attended") {
      const payAmount = presentType
        ? await computeTrialPay(tx, {
            tenantId,
            lessonId: trial.lesson.id,
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
    } else if (effectiveStatus === "no_show" || effectiveStatus === "cancelled") {
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
