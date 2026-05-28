import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { resolveRate } from "@/lib/salary/resolve-rate"
import { calcPay } from "@/lib/salary/calc-pay"
import { logAudit } from "@/lib/audit"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const schema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  // На занятие добавляется ребёнок-подопечный, не родитель. wardId обязателен.
  wardId: z.string().uuid("Подопечный обязателен"),
  source: z.enum(["subscription", "balance"]),
  subscriptionId: z.string().uuid().optional(),
  // Стоимость списания с баланса родителя (для source=balance).
  // Если не передано — берётся Direction.singleVisitPrice; если и его нет — Direction.lessonPrice.
  amount: z.number().nonnegative().optional(),
  // Разовое посещение — НЕ создавать GroupEnrollment.
  isOneTime: z.boolean().default(false),
})

/**
 * POST /api/lessons/[id]/add-student
 *
 * Добавляет ребёнка на занятие — Ф4.2.
 *  - source="subscription": списываем с активного абонемента на этой группе.
 *  - source="balance": списываем с clientBalance родителя по цене разового посещения.
 *  - isOneTime=false: дополнительно создаём GroupEnrollment, ребёнок становится
 *    постоянным участником группы.
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
  const data = parsed.data
  const wardId = data.wardId

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

  // Ребёнок принадлежит клиенту?
  const ward = await db.ward.findFirst({
    where: { id: wardId, clientId: data.clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  // Уже отмечен на этом занятии?
  if (lesson.attendances.some((a) => a.clientId === data.clientId && a.wardId === wardId)) {
    return NextResponse.json({ error: "Ученик уже на этом занятии" }, { status: 409 })
  }

  // Переполнение группы
  const enrollmentCount = await db.groupEnrollment.count({
    where: { groupId: lesson.groupId, tenantId, isActive: true, deletedAt: null },
  })
  if (lesson.attendances.length >= lesson.group.maxStudents && enrollmentCount >= lesson.group.maxStudents) {
    return NextResponse.json({ error: "Занятие заполнено (максимум учеников)" }, { status: 409 })
  }

  // Резолв источника списания
  let subscription: {
    id: string
    lessonPrice: Prisma.Decimal
    balance: Prisma.Decimal
  } | null = null
  let chargeFromBalanceAmount: Prisma.Decimal | null = null

  if (data.source === "subscription") {
    const lessonDate = new Date(lesson.date)
    subscription = await db.subscription.findFirst({
      where: {
        tenantId,
        clientId: data.clientId,
        wardId,
        groupId: lesson.groupId,
        deletedAt: null,
        status: { in: ["active", "pending"] },
        periodYear: lessonDate.getFullYear(),
        periodMonth: lessonDate.getMonth() + 1,
        ...(data.subscriptionId ? { id: data.subscriptionId } : {}),
      },
      select: { id: true, lessonPrice: true, balance: true },
      orderBy: { startDate: "desc" },
    })
    if (!subscription) {
      return NextResponse.json(
        { error: "У ребёнка нет активного абонемента на эту группу/период" },
        { status: 400 },
      )
    }
    if (Number(subscription.balance) <= 0) {
      return NextResponse.json(
        { error: "На абонементе нет остатка занятий" },
        { status: 400 },
      )
    }
  } else {
    const fallback =
      lesson.group.direction.singleVisitPrice ?? lesson.group.direction.lessonPrice
    const amount =
      data.amount !== undefined ? new Prisma.Decimal(data.amount) : new Prisma.Decimal(fallback)
    if (amount.lt(0)) {
      return NextResponse.json({ error: "Стоимость не может быть отрицательной" }, { status: 400 })
    }
    chargeFromBalanceAmount = amount
  }

  // Тип «Был» (системный)
  const presentType = await db.attendanceType.findFirst({
    where: { code: "present", OR: [{ tenantId: null }, { tenantId }], isActive: true },
    select: { id: true, paysInstructor: true },
  })
  if (!presentType) {
    return NextResponse.json({ error: "Тип посещения «Был» не найден" }, { status: 500 })
  }

  // Ставка ЗП
  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const resolvedRate = await resolveRate(db, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  })

  const chargeAmount = subscription ? subscription.lessonPrice : chargeFromBalanceAmount!

  const result = await db.$transaction(async (tx) => {
    // 1. Enrollment (если не разовое)
    if (!data.isOneTime) {
      const existingEnrollment = await tx.groupEnrollment.findFirst({
        where: {
          tenantId,
          groupId: lesson.groupId,
          clientId: data.clientId,
          wardId,
          deletedAt: null,
        },
      })
      if (existingEnrollment) {
        if (!existingEnrollment.isActive) {
          await tx.groupEnrollment.update({
            where: { id: existingEnrollment.id },
            data: { isActive: true, withdrawnAt: null },
          })
        }
      } else {
        await tx.groupEnrollment.create({
          data: {
            tenantId,
            groupId: lesson.groupId,
            clientId: data.clientId,
            wardId,
            enrolledAt: new Date(lesson.date),
            isActive: true,
          },
        })
      }
    }

    // 2. ЗП инструктору
    let instructorPayAmount = new Prisma.Decimal(0)
    if (presentType.paysInstructor && resolvedRate) {
      instructorPayAmount = await calcPay(tx, {
        rate: resolvedRate,
        lessonId,
        tenantId,
        currentClientId: data.clientId,
        currentChargeAmount: chargeAmount,
      })
    }

    // 3. Attendance
    const att = await tx.attendance.create({
      data: {
        tenantId,
        lessonId,
        subscriptionId: subscription?.id ?? null,
        clientId: data.clientId,
        wardId,
        attendanceTypeId: presentType.id,
        chargeAmount,
        instructorPayAmount,
        instructorPayEnabled: true,
        markedBy: employeeId,
        markedAt: new Date(),
      },
    })

    // 4. Списание
    if (subscription) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          balance: { decrement: chargeAmount },
          chargedAmount: { increment: chargeAmount },
        },
      })
    } else if (chargeFromBalanceAmount && chargeFromBalanceAmount.gt(0)) {
      await applyBalanceDelta(tx, {
        tenantId,
        clientId: data.clientId,
        delta: chargeFromBalanceAmount.negated(),
        type: "personal_lesson_charge",
        refs: {
          lessonId,
          attendanceId: att.id,
          directionId: lesson.group.directionId,
        },
        createdBy: employeeId,
        comment: data.isOneTime ? "Разовое посещение" : "Списание с баланса родителя",
      })
    }

    // 5. Lead → Client конверсия (как в обычной отметке) — только если списано платно
    if (Number(chargeAmount) > 0) {
      const client = await tx.client.findUnique({ where: { id: data.clientId } })
      if (client && client.funnelStatus !== "active_client" && client.clientStatus !== "active") {
        await tx.client.update({
          where: { id: data.clientId },
          data: { funnelStatus: "active_client", clientStatus: "active" },
        })
      }
    }

    return att
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: result.id,
    changes: {
      lessonId: { new: lessonId },
      clientId: { new: data.clientId },
      wardId: { new: wardId },
      source: { new: data.source },
      isOneTime: { new: data.isOneTime },
      subscriptionId: { new: subscription?.id ?? null },
      chargeAmount: { new: Number(chargeAmount) },
    },
    req,
  })

  return NextResponse.json(result)
}
