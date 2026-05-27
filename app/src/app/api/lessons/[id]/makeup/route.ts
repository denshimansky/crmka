import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { resolveRate } from "@/lib/salary/resolve-rate"
import { calcPay } from "@/lib/salary/calc-pay"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const makeupSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.string().uuid("Не выбран подопечный"),
  originalLessonId: z.string().uuid("Не выбрано пропущенное занятие"),
})

/**
 * POST /api/lessons/[id]/makeup
 *
 * Добавляет ученика на занятие (id из URL) как отработку конкретного оригинального
 * занятия (originalLessonId). Списание идёт с абонемента ребёнка по группе
 * оригинального занятия — т.е. по цене изначального направления. Без привязки
 * к направлению текущего занятия.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId
  const role = session.user.role

  const body = await req.json()
  const parsed = makeupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const data = parsed.data

  if (data.originalLessonId === lessonId) {
    return NextResponse.json(
      { error: "Нельзя отрабатывать пропуск на том же самом занятии" },
      { status: 400 },
    )
  }

  // Текущее занятие, на которое добавляется отработка
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: { include: { direction: true } },
      attendances: { select: { id: true, clientId: true, wardId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json(
      { error: "Период закрыт. Обратитесь к владельцу или управляющему." },
      { status: 403 },
    )
  }

  // Оригинальное занятие (которое отрабатывается)
  const originalLesson = await db.lesson.findFirst({
    where: { id: data.originalLessonId, tenantId },
    include: { group: { select: { id: true, name: true, directionId: true } } },
  })
  if (!originalLesson) {
    return NextResponse.json({ error: "Оригинальное занятие не найдено" }, { status: 404 })
  }

  // Подопечный должен принадлежать клиенту
  const ward = await db.ward.findFirst({
    where: { id: data.wardId, clientId: data.clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  // Ученик уже на этом занятии?
  const alreadyAttending = lesson.attendances.some(
    (a) => a.clientId === data.clientId && a.wardId === data.wardId,
  )
  if (alreadyAttending) {
    return NextResponse.json(
      { error: "Ученик уже отмечен на этом занятии" },
      { status: 409 },
    )
  }

  // Этот пропуск уже отработан раньше?
  const existingMakeup = await db.attendance.findFirst({
    where: {
      tenantId,
      wardId: data.wardId,
      makeupOfLessonId: data.originalLessonId,
    },
    select: { id: true },
  })
  if (existingMakeup) {
    return NextResponse.json(
      { error: "Это занятие уже отработано в другой группе" },
      { status: 409 },
    )
  }

  // Переполнение
  const enrollmentCount = await db.groupEnrollment.count({
    where: { groupId: lesson.groupId, tenantId, isActive: true, deletedAt: null },
  })
  const totalAttendees = lesson.attendances.length
  if (
    totalAttendees >= lesson.group.maxStudents &&
    enrollmentCount >= lesson.group.maxStudents
  ) {
    return NextResponse.json(
      { error: "Занятие заполнено (максимум учеников)" },
      { status: 409 },
    )
  }

  // Активный абонемент ребёнка по группе ИЗНАЧАЛЬНОГО занятия.
  // Если несколько активных — берём ближайший к дате оригинального занятия.
  const subscription = await db.subscription.findFirst({
    where: {
      tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      groupId: originalLesson.group.id,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
    orderBy: [{ startDate: "desc" }],
  })
  if (!subscription) {
    return NextResponse.json(
      {
        error:
          "У ребёнка нет активного абонемента в группе «" +
          originalLesson.group.name +
          "». Списать отработку не с чего.",
      },
      { status: 400 },
    )
  }

  // Тип посещения «Явка» для отработки
  const presentType = await db.attendanceType.findFirst({
    where: { code: "present", OR: [{ tenantId: null }, { tenantId }], isActive: true },
  })
  if (!presentType) {
    return NextResponse.json({ error: "Тип посещения «Явка» не найден" }, { status: 500 })
  }

  const chargeAmount = subscription.lessonPrice

  // ЗП инструктору через единую утилиту — все 5 схем поддерживаются
  // одинаково для отметки, отработки и bulk.
  let instructorPayAmount = new Prisma.Decimal(0)
  const resolvedRate = await resolveRate(db, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: lesson.substituteInstructorId || lesson.instructorId,
    directionId: lesson.group.directionId,
  })

  const attendance = await db.$transaction(async (tx) => {
    if (resolvedRate) {
      instructorPayAmount = await calcPay(tx, {
        rate: resolvedRate,
        lessonId,
        tenantId,
        currentClientId: data.clientId,
        currentChargeAmount: chargeAmount,
      })
    }
    const att = await tx.attendance.create({
      data: {
        tenantId,
        lessonId,
        subscriptionId: subscription.id,
        clientId: data.clientId,
        wardId: data.wardId,
        attendanceTypeId: presentType.id,
        chargeAmount,
        instructorPayAmount,
        instructorPayEnabled: true,
        isMakeup: true,
        makeupOfLessonId: data.originalLessonId,
        markedBy: employeeId,
        markedAt: new Date(),
      },
    })

    if (Number(chargeAmount) > 0) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          balance: { decrement: chargeAmount },
          chargedAmount: { increment: chargeAmount },
        },
      })
    }

    return att
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: attendance.id,
    changes: {
      lessonId: { new: lessonId },
      clientId: { new: data.clientId },
      wardId: { new: data.wardId },
      isMakeup: { new: true },
      makeupOfLessonId: { new: data.originalLessonId },
      subscriptionId: { new: subscription.id },
    },
    req,
  })

  return NextResponse.json(attendance)
}
