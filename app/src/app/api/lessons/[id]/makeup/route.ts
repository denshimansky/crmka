import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const makeupSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  subscriptionId: z.string().uuid("Необходим абонемент для отработки"),
})

/**
 * POST /api/lessons/[id]/makeup
 * Добавляет ученика на занятие как отработку (isMakeup: true).
 * Ученик не зачислен в эту группу — посещает разово.
 * Списывается 1 занятие с переданного абонемента.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId
  const role = (session.user as any).role

  const body = await req.json()
  const parsed = makeupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Verify lesson exists and belongs to tenant
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: {
        include: { direction: true },
      },
      attendances: { select: { id: true, clientId: true, wardId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // Проверка закрытия периода
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Проверяем: ученик уже на этом занятии?
  const alreadyAttending = lesson.attendances.some(
    a => a.clientId === data.clientId && (data.wardId ? a.wardId === data.wardId : !a.wardId)
  )
  if (alreadyAttending) {
    return NextResponse.json({ error: "Ученик уже отмечен на этом занятии" }, { status: 409 })
  }

  // Проверяем: занятие не переполнено
  const enrollmentCount = await db.groupEnrollment.count({
    where: { groupId: lesson.groupId, tenantId, isActive: true, deletedAt: null },
  })
  const totalAttendees = lesson.attendances.length
  if (totalAttendees >= lesson.group.maxStudents && enrollmentCount >= lesson.group.maxStudents) {
    return NextResponse.json({ error: "Занятие заполнено (максимум учеников)" }, { status: 409 })
  }

  // Проверяем абонемент
  const subscription = await db.subscription.findFirst({
    where: {
      id: data.subscriptionId,
      tenantId,
      clientId: data.clientId,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
  })
  if (!subscription) {
    return NextResponse.json({ error: "Абонемент не найден или неактивен" }, { status: 404 })
  }

  // Get "present" attendance type
  const presentType = await db.attendanceType.findFirst({
    where: {
      code: "present",
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!presentType) {
    return NextResponse.json({ error: "Тип посещения «Явка» не найден" }, { status: 500 })
  }

  const chargeAmount = subscription.lessonPrice

  // Calculate instructor pay
  let instructorPayAmount = new Prisma.Decimal(0)
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: lesson.substituteInstructorId || lesson.instructorId,
      directionId: lesson.group.directionId,
    },
  })
  if (salaryRate) {
    if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
      instructorPayAmount = salaryRate.ratePerStudent
    } else if (salaryRate.scheme === "fixed_plus_per_student" && salaryRate.ratePerStudent) {
      instructorPayAmount = salaryRate.ratePerStudent
    }
    // per_lesson не добавляем — это разовый ученик, занятие уже оплачено основным составом
  }

  // Транзакция: создаём attendance + списываем с абонемента
  const attendance = await db.$transaction(async (tx) => {
    const att = await tx.attendance.create({
      data: {
        tenantId,
        lessonId,
        subscriptionId: data.subscriptionId,
        clientId: data.clientId,
        wardId: data.wardId,
        attendanceTypeId: presentType.id,
        chargeAmount,
        instructorPayAmount,
        instructorPayEnabled: true,
        isMakeup: true,
        markedBy: employeeId,
        markedAt: new Date(),
      },
    })

    // Списать с абонемента
    if (Number(chargeAmount) > 0) {
      await tx.subscription.update({
        where: { id: data.subscriptionId },
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
      isMakeup: { new: true },
      subscriptionId: { new: data.subscriptionId },
    },
    req,
  })

  return NextResponse.json(attendance)
}
