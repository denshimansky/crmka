import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { z } from "zod"

const schema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  // На занятие добавляется ребёнок-подопечный, не родитель. wardId обязателен.
  wardId: z.string().uuid("Подопечный обязателен"),
  // Разовое посещение: не создаём GroupEnrollment, создаём placeholder Attendance
  // (isPending=true, без списаний). Списание произойдёт при отметке «Был».
  // Для занятий в скрытой Group(isOneTime=true) клиент всегда присылает true.
  isOneTime: z.boolean().default(false),
})

/**
 * POST /api/lessons/[id]/add-student
 *
 * Добавляет ребёнка на занятие. Без списаний — статус «Не отмечен».
 *  - isOneTime=false: создаём GroupEnrollment (постоянный участник группы).
 *  - isOneTime=true: создаём placeholder Attendance с isPending=true (разовое
 *    посещение без зачисления). attendance_type_id ставим «present» как заглушку,
 *    charge_amount=0; реальная отметка через /attendance перепишет тип и сумму.
 *
 * Списание (с абонемента или баланса) происходит в обоих случаях позже —
 * через POST /api/lessons/[id]/attendance, когда оператор отмечает «Был».
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "admin" && role !== "manager" && role !== "owner") {
    return NextResponse.json({ error: "Недостаточно прав для добавления ученика" }, { status: 403 })
  }

  const { id: lessonId } = await params
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const { clientId, wardId, isOneTime } = parsed.data

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      id: true,
      date: true,
      groupId: true,
      group: { select: { maxStudents: true, isOneTime: true, deletedAt: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })
  if (lesson.group.deletedAt) {
    return NextResponse.json(
      { error: "Группа в архиве — нельзя добавить ученика. Восстановите группу или выберите другую." },
      { status: 400 },
    )
  }

  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json(
      { error: "Период закрыт. Обратитесь к владельцу или управляющему." },
      { status: 403 },
    )
  }

  const ward = await db.ward.findFirst({
    where: { id: wardId, clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  // Уже на занятии или зачислен в группу — исключаем
  const existingAttendance = await db.attendance.findFirst({
    where: { tenantId, lessonId, clientId, wardId },
    select: { id: true },
  })
  if (existingAttendance) {
    return NextResponse.json({ error: "Ученик уже на этом занятии" }, { status: 409 })
  }
  const existingEnrollment = await db.groupEnrollment.findFirst({
    where: { tenantId, groupId: lesson.groupId, clientId, wardId, deletedAt: null },
    select: { id: true, isActive: true },
  })
  if (existingEnrollment?.isActive && !isOneTime) {
    return NextResponse.json({ error: "Ученик уже зачислен в эту группу" }, { status: 409 })
  }

  const activeEnrollmentCount = await db.groupEnrollment.count({
    where: { groupId: lesson.groupId, tenantId, isActive: true, deletedAt: null },
  })
  if (!isOneTime && activeEnrollmentCount >= lesson.group.maxStudents) {
    return NextResponse.json({ error: "Группа заполнена (максимум учеников)" }, { status: 409 })
  }

  if (isOneTime) {
    // Placeholder Attendance — заглушка типа 'present', без списаний.
    const presentType = await db.attendanceType.findFirst({
      where: { code: "present", OR: [{ tenantId: null }, { tenantId }], isActive: true },
      select: { id: true },
    })
    if (!presentType) {
      return NextResponse.json({ error: "Системный тип «Был» не найден" }, { status: 500 })
    }

    const att = await db.attendance.create({
      data: {
        tenantId,
        lessonId,
        clientId,
        wardId,
        attendanceTypeId: presentType.id,
        chargeAmount: 0,
        instructorPayAmount: 0,
        instructorPayEnabled: true,
        isPending: true,
        markedBy: null,
        markedAt: null,
      },
    })

    logAudit({
      tenantId,
      employeeId,
      action: "create",
      entityType: "Attendance",
      entityId: att.id,
      changes: {
        lessonId: { new: lessonId },
        clientId: { new: clientId },
        wardId: { new: wardId },
        isPending: { new: true },
        isOneTime: { new: true },
      },
      req,
    })

    return NextResponse.json({ attendanceId: att.id, clientId, wardId, isPending: true })
  }

  // Постоянное зачисление: создаём (или реактивируем) GroupEnrollment.
  const enrollment = existingEnrollment
    ? await db.groupEnrollment.update({
        where: { id: existingEnrollment.id },
        data: { isActive: true, withdrawnAt: null },
      })
    : await db.groupEnrollment.create({
        data: {
          tenantId,
          groupId: lesson.groupId,
          clientId,
          wardId,
          enrolledAt: new Date(lesson.date),
          isActive: true,
        },
      })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "GroupEnrollment",
    entityId: enrollment.id,
    changes: {
      lessonId: { new: lessonId },
      groupId: { new: lesson.groupId },
      clientId: { new: clientId },
      wardId: { new: wardId },
    },
    req,
  })

  return NextResponse.json({ enrollmentId: enrollment.id, clientId, wardId })
}
