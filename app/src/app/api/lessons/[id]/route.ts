import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  topic: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  homework: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
  cancelReason: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
})

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

  // Get salary rate for this instructor + direction
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: lesson.instructorId,
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

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.lesson.findFirst({ where: { id, tenantId } })
  if (!existing) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const updateData: Record<string, unknown> = {}
  if (data.topic !== undefined) updateData.topic = data.topic
  if (data.homework !== undefined) updateData.homework = data.homework
  if (data.status !== undefined) updateData.status = data.status
  if (data.cancelReason !== undefined) updateData.cancelReason = data.cancelReason

  const lesson = await db.lesson.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json(lesson)
}
