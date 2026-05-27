import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { isPeriodLocked } from "@/lib/period-check"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { calcRefund } from "@/lib/balance/calc-refund"
import { logAudit } from "@/lib/audit"
import { createMissedMakeupTask } from "@/lib/tasks/missed-makeup"

const updateSchema = z.object({
  topic: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  homework: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
  cancelReason: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  substituteInstructorId: z.any().transform(v => {
    if (v === null || v === "") return null
    if (typeof v === "string" && v.trim()) return v.trim()
    return undefined
  }),
  // Перенос даты / времени / длительности — Ф4.1
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD").optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Время в формате HH:MM").optional(),
  durationMinutes: z.number().int().positive().max(600).optional(),
  // Подтверждение сброса отметок (если на занятии есть посещения)
  confirmResetAttendances: z.boolean().optional(),
})

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

function intervalsOverlap(s1: number, d1: number, s2: number, d2: number): boolean {
  return s1 < s2 + d2 && s2 < s1 + d1
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const lesson = await db.lesson.findFirst({
    where: { id, tenantId },
    include: {
      group: {
        include: {
          direction: { select: { id: true, name: true, lessonPrice: true } },
          room: { select: { id: true, name: true } },
        },
      },
      instructor: { select: { id: true, firstName: true, lastName: true } },
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
      attendances: {
        include: {
          attendanceType: true,
          subscription: { select: { id: true, lessonPrice: true, balance: true } },
        },
      },
    },
  })

  if (!lesson) {
    return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })
  }

  // Get enrolled students for this group (active enrollments)
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // For each enrollment, find active subscription for this group & current period
  const lessonDate = new Date(lesson.date)
  const periodYear = lessonDate.getFullYear()
  const periodMonth = lessonDate.getMonth() + 1

  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      groupId: lesson.groupId,
      periodYear,
      periodMonth,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      lessonPrice: true,
      balance: true,
      chargedAmount: true,
    },
  })

  // Get available attendance types (system + tenant-specific)
  const attendanceTypes = await db.attendanceType.findMany({
    where: {
      OR: [
        { tenantId: null },
        { tenantId },
      ],
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  })

  // Get salary rate — if substitute, use their rate
  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: effectiveInstructorId,
      directionId: lesson.group.directionId,
    },
  })

  // Build students list with their attendance and subscription info
  const students = enrollments.map((enrollment) => {
    const attendance = lesson.attendances.find(
      (a) => a.clientId === enrollment.clientId && (
        // Match by ward if ward exists
        enrollment.wardId ? a.wardId === enrollment.wardId : !a.wardId
      )
    )

    const subscription = subscriptions.find(
      (s) => s.clientId === enrollment.clientId && (
        enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
      )
    )

    return {
      enrollmentId: enrollment.id,
      clientId: enrollment.clientId,
      clientName: [enrollment.client.lastName, enrollment.client.firstName].filter(Boolean).join(" ") || "Без имени",
      clientPhone: enrollment.client.phone || null,
      wardId: enrollment.wardId,
      wardName: enrollment.ward
        ? [enrollment.ward.lastName, enrollment.ward.firstName].filter(Boolean).join(" ")
        : null,
      subscriptionId: subscription?.id || null,
      subscriptionBalance: subscription ? Number(subscription.balance) : null,
      lessonPrice: subscription ? Number(subscription.lessonPrice) : Number(lesson.group.direction.lessonPrice),
      attendance: attendance
        ? {
            id: attendance.id,
            attendanceTypeId: attendance.attendanceTypeId,
            attendanceTypeName: attendance.attendanceType.name,
            attendanceTypeCode: attendance.attendanceType.code,
            chargeAmount: Number(attendance.chargeAmount),
            instructorPayAmount: Number(attendance.instructorPayAmount),
            instructorPayEnabled: attendance.instructorPayEnabled,
            markedAt: attendance.markedAt,
          }
        : null,
    }
  })

  return NextResponse.json({
    id: lesson.id,
    date: lesson.date,
    startTime: lesson.startTime,
    durationMinutes: lesson.durationMinutes,
    status: lesson.status,
    topic: lesson.topic,
    homework: lesson.homework,
    isTrial: lesson.isTrial,
    isMakeup: lesson.isMakeup,
    group: {
      id: lesson.group.id,
      name: lesson.group.name,
      directionId: lesson.group.directionId,
      directionName: lesson.group.direction.name,
      roomName: lesson.group.room.name,
    },
    instructor: {
      id: lesson.instructor.id,
      name: [lesson.instructor.lastName, lesson.instructor.firstName].filter(Boolean).join(" "),
    },
    substituteInstructor: lesson.substituteInstructor
      ? {
          id: lesson.substituteInstructor.id,
          name: [lesson.substituteInstructor.lastName, lesson.substituteInstructor.firstName].filter(Boolean).join(" "),
        }
      : null,
    salaryRate: salaryRate
      ? {
          scheme: salaryRate.scheme,
          ratePerStudent: salaryRate.ratePerStudent ? Number(salaryRate.ratePerStudent) : null,
          ratePerLesson: salaryRate.ratePerLesson ? Number(salaryRate.ratePerLesson) : null,
          fixedPerShift: salaryRate.fixedPerShift ? Number(salaryRate.fixedPerShift) : null,
        }
      : null,
    students,
    attendanceTypes: attendanceTypes.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      chargesSubscription: t.chargesSubscription,
      paysInstructor: t.paysInstructor,
      countsAsRevenue: t.countsAsRevenue,
      isSystem: t.isSystem,
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId
  const role = (session.user as any).role
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.lesson.findFirst({
    where: { id, tenantId },
    include: {
      group: { select: { id: true, name: true, roomId: true, directionId: true, room: { select: { name: true } } } },
      _count: { select: { attendances: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // ── Ф4.1: Перенос даты/времени ──
  const isMove =
    data.date !== undefined ||
    data.startTime !== undefined ||
    data.durationMinutes !== undefined

  let newDate = existing.date
  let newStartTime = existing.startTime
  let newDurationMinutes = existing.durationMinutes
  const attendancesCount = existing._count.attendances

  if (isMove) {
    if (data.date !== undefined) {
      const d = new Date(data.date)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
      }
      newDate = d
    }
    if (data.startTime !== undefined) newStartTime = data.startTime
    if (data.durationMinutes !== undefined) newDurationMinutes = data.durationMinutes

    // Закрытый период (старая И новая даты) — нельзя для не-владельца/не-управляющего
    if (await isPeriodLocked(tenantId, new Date(existing.date), role)) {
      return NextResponse.json(
        { error: "Старая дата в закрытом периоде. Перенос невозможен." },
        { status: 403 },
      )
    }
    if (await isPeriodLocked(tenantId, newDate, role)) {
      return NextResponse.json(
        { error: "Новая дата в закрытом периоде. Перенос невозможен." },
        { status: 403 },
      )
    }

    // Права: без отметок → admin/manager/owner, с отметками → только manager/owner.
    if (attendancesCount > 0) {
      if (role !== "manager" && role !== "owner") {
        return NextResponse.json(
          { error: "Перенос занятия с отметками доступен только управляющему или владельцу" },
          { status: 403 },
        )
      }
    } else {
      if (role !== "admin" && role !== "manager" && role !== "owner") {
        return NextResponse.json(
          { error: "Недостаточно прав для переноса занятия" },
          { status: 403 },
        )
      }
    }

    // Если есть отметки и нет подтверждения — возвращаем 409 для модалки подтверждения
    if (attendancesCount > 0 && !data.confirmResetAttendances) {
      return NextResponse.json(
        {
          error: `На занятии ${attendancesCount} отметок. Подтвердите сброс отметок для переноса.`,
          requiresConfirmation: true,
          attendancesCount,
        },
        { status: 409 },
      )
    }

    // Конфликт: педагог или кабинет уже заняты в новой дате/времени.
    const effectiveInstructorId = existing.substituteInstructorId || existing.instructorId
    const candidates = await db.lesson.findMany({
      where: {
        tenantId,
        date: newDate,
        id: { not: id },
        status: { not: "cancelled" },
        OR: [
          { instructorId: effectiveInstructorId },
          { substituteInstructorId: effectiveInstructorId },
          { group: { roomId: existing.group.roomId } },
        ],
      },
      select: {
        id: true,
        startTime: true,
        durationMinutes: true,
        instructorId: true,
        substituteInstructorId: true,
        group: {
          select: {
            name: true,
            roomId: true,
            room: { select: { name: true } },
          },
        },
        instructor: { select: { firstName: true, lastName: true } },
      },
    })
    const newStart = timeToMinutes(newStartTime)
    const conflicts = candidates.filter((l) =>
      intervalsOverlap(newStart, newDurationMinutes, timeToMinutes(l.startTime), l.durationMinutes),
    )
    if (conflicts.length > 0) {
      const first = conflicts[0]
      const sameInstructor =
        first.instructorId === effectiveInstructorId ||
        first.substituteInstructorId === effectiveInstructorId
      const reason = sameInstructor
        ? `педагог уже занят (${[first.instructor.lastName, first.instructor.firstName].filter(Boolean).join(" ") || "—"})`
        : `кабинет «${first.group.room?.name || "—"}» уже занят`
      return NextResponse.json(
        {
          error: `Конфликт: ${reason} в ${first.startTime} (группа «${first.group.name}»)`,
          conflicts: conflicts.map((c) => ({
            id: c.id,
            startTime: c.startTime,
            groupName: c.group.name,
            roomName: c.group.room?.name || null,
          })),
        },
        { status: 409 },
      )
    }
  }

  // ── Состав обновления ──
  const updateData: Record<string, unknown> = {}
  if (data.topic !== undefined) updateData.topic = data.topic
  if (data.homework !== undefined) updateData.homework = data.homework
  if (data.status !== undefined) updateData.status = data.status
  if (data.cancelReason !== undefined) updateData.cancelReason = data.cancelReason
  if (data.substituteInstructorId !== undefined) updateData.substituteInstructorId = data.substituteInstructorId
  if (data.date !== undefined) updateData.date = newDate
  if (data.startTime !== undefined) updateData.startTime = newStartTime
  if (data.durationMinutes !== undefined) updateData.durationMinutes = newDurationMinutes

  // ── Транзакция: откат отметок (если перенос с подтверждением) + апдейт занятия ──
  const lesson = await db.$transaction(async (tx) => {
    if (isMove && attendancesCount > 0) {
      const attendances = await tx.attendance.findMany({
        where: { lessonId: id, tenantId },
        include: { attendanceType: { select: { chargePercent: true } } },
      })

      for (const att of attendances) {
        // Откат списания с абонемента
        if (att.subscriptionId && Number(att.chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: att.subscriptionId },
            data: {
              balance: { increment: att.chargeAmount },
              chargedAmount: { decrement: att.chargeAmount },
            },
          })
        }
        // Откат lesson_refund (если был возврат за частичное списание)
        if (Number(att.chargeAmount) > 0) {
          const refund = calcRefund(att.chargeAmount, att.attendanceType.chargePercent)
          if (refund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: att.clientId,
              delta: refund.negated(),
              type: "attendance_revert",
              refs: {
                lessonId: id,
                attendanceId: att.id,
                directionId: existing.group.directionId,
                subscriptionId: att.subscriptionId,
              },
              createdBy: employeeId,
            })
          }
        }
        await tx.attendance.delete({ where: { id: att.id } })
      }
    }

    return tx.lesson.update({ where: { id }, data: updateData })
  })

  if (isMove) {
    logAudit({
      tenantId,
      employeeId,
      action: "update",
      entityType: "Lesson",
      entityId: id,
      changes: {
        date: {
          old: existing.date.toISOString().slice(0, 10),
          new: newDate.toISOString().slice(0, 10),
        },
        startTime: { old: existing.startTime, new: newStartTime },
        durationMinutes: { old: existing.durationMinutes, new: newDurationMinutes },
        ...(attendancesCount > 0 ? { attendancesReset: { new: attendancesCount } } : {}),
      },
      req,
    })
  }

  // Ф7: если занятие переведено в «cancelled» и оно было целевым для отработок —
  // создаём задачу админу переназначить каждому из «ожидающих».
  if (data.status === "cancelled" && existing.status !== "cancelled") {
    const scheduledArrivals = await db.attendance.findMany({
      where: {
        tenantId,
        scheduledMakeupLessonId: id,
        attendanceType: { code: "makeup_scheduled" },
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
        lesson: {
          select: {
            date: true,
            group: { select: { direction: { select: { name: true } } } },
          },
        },
      },
    })
    // Ward не имеет relation в Attendance — подгружаем имена отдельным запросом.
    const arrivalWardIds = scheduledArrivals
      .map((a) => a.wardId)
      .filter((x): x is string => !!x)
    const arrivalWards = arrivalWardIds.length
      ? await db.ward.findMany({
          where: { id: { in: arrivalWardIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const targetDirection = await db.direction.findUnique({
      where: { id: existing.group.directionId },
      select: { name: true },
    })
    for (const arrival of scheduledArrivals) {
      const ward = arrival.wardId ? arrivalWards.find((w) => w.id === arrival.wardId) : null
      const wardName = ward
        ? [ward.lastName, ward.firstName].filter(Boolean).join(" ")
        : ""
      const clientName = [arrival.client.lastName, arrival.client.firstName].filter(Boolean).join(" ")
      const childDisplayName = wardName || clientName || "Без имени"
      await createMissedMakeupTask(db, {
        tenantId,
        clientId: arrival.clientId,
        childDisplayName,
        sourceLessonDate: arrival.lesson.date,
        sourceDirectionName: arrival.lesson.group.direction.name,
        targetLessonDate: new Date(existing.date),
        targetDirectionName: targetDirection?.name ?? "—",
        reason: "lesson_cancelled",
      })
    }
  }

  return NextResponse.json(lesson)
}

// DELETE — полное удаление занятия. Защита от случайного создания / неверной генерации.
// Доступно: owner, manager, admin. Отказ, если есть посещения или пробные — сначала их снять.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager" && role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const lesson = await db.lesson.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      date: true,
      _count: {
        select: {
          attendances: true,
          trialLessons: { where: { status: { not: "cancelled" } } },
        },
      },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // Закрытый период — нельзя
  const { isPeriodLocked } = await import("@/lib/period-check")
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  if (lesson._count.attendances > 0) {
    return NextResponse.json(
      { error: "На занятии есть отметки посещений. Сначала снимите их (выбор «Не отмечен»)." },
      { status: 400 }
    )
  }
  if (lesson._count.trialLessons > 0) {
    return NextResponse.json(
      { error: "К занятию привязаны активные пробные. Сначала отмените их (✕ в карточке лида) или переведите в «Отменено»." },
      { status: 400 }
    )
  }

  // Отвяжем отменённые пробные от занятия, чтобы FK не блокировал удаление
  await db.trialLesson.updateMany({
    where: { lessonId: id, status: "cancelled" },
    data: { lessonId: null },
  })

  await db.lesson.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
