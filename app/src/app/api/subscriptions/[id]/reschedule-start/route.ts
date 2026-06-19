import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import {
  recalcClientDiscounts,
  repriceSubscription,
} from "@/lib/discounts/recalc-client-discounts"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"

const schema = z.object({
  firstPaidLessonDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
})

/**
 * Пересчёт неоплаченного (pending) календарного абонемента под новую дату старта.
 *
 * Используется инлайн-ячейкой «Дата 1-го платного» на вкладке «Ожидаем оплату»
 * (/crm/sales): админ меняет дату первого платного занятия, и абонемент должен
 * пересчитаться так же, как при первичной выписке в модалке перевода
 * (см. /api/wards/[id]/move-to-awaiting-payment):
 *   — totalLessons = занятия группы с новой даты до конца её месяца,
 *   — totalAmount = lessonPrice × totalLessons,
 *   — finalAmount/balance/discountAmount пересчитываются с учётом скидок,
 *   — startDate/periodYear/periodMonth и GroupEnrollment.enrolledAt сдвигаются,
 *   — Application.firstPaidLessonDate (per-ребёнок, его показывает ячейка) и
 *     агрегат Client.firstPaidLessonDate (для отчётов) обновляются.
 *
 * Только для pending: на вкладке «Ожидаем оплату» оплаченных абонементов нет —
 * после оплаты клиент уходит из воронки в «Активные».
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = session.user.role
  if (!["owner", "manager", "admin"].includes(role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const sub = await db.subscription.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      groupId: true,
      directionId: true,
      status: true,
      type: true,
      lessonPrice: true,
    },
  })
  if (!sub) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  }
  if (sub.type !== "calendar") {
    return NextResponse.json(
      { error: "Пересчёт по дате доступен только для календарного абонемента." },
      { status: 400 },
    )
  }
  if (sub.status !== "pending") {
    return NextResponse.json(
      { error: "Пересчёт доступен только для неоплаченного (pending) абонемента." },
      { status: 400 },
    )
  }
  if (!sub.groupId) {
    return NextResponse.json(
      { error: "У абонемента не указана группа — пересчёт по расписанию невозможен." },
      { status: 400 },
    )
  }

  const firstPaid = new Date(parsed.data.firstPaidLessonDate)
  const periodYear = firstPaid.getFullYear()
  const periodMonth = firstPaid.getMonth() + 1
  const nextMonthStart = new Date(periodYear, periodMonth, 1)

  // Занятия группы с новой даты до конца её месяца — за них платит этот абонемент.
  const totalLessons = await db.lesson.count({
    where: {
      tenantId,
      groupId: sub.groupId,
      date: { gte: firstPaid, lt: nextMonthStart },
      status: { in: ["scheduled", "completed"] },
    },
  })
  if (totalLessons === 0) {
    return NextResponse.json(
      {
        error:
          "С выбранной даты до конца месяца у группы нет занятий. Выберите дату занятия группы.",
      },
      { status: 400 },
    )
  }

  // Запрет дублей (баг #52): не должно быть второго живого абонемента в ту же
  // группу за тот же период (кроме самого пересчитываемого).
  const duplicate = await db.subscription.findFirst({
    where: {
      tenantId,
      wardId: sub.wardId,
      groupId: sub.groupId,
      periodYear,
      periodMonth,
      status: { in: ["pending", "active"] },
      deletedAt: null,
      id: { not: sub.id },
    },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: "У подопечного уже есть абонемент в эту группу на выбранный период." },
      { status: 409 },
    )
  }

  const lessonPrice = new Prisma.Decimal(sub.lessonPrice)
  const totalAmount = lessonPrice.mul(totalLessons)

  const result = await db.$transaction(async (tx) => {
    // Сдвигаем дату/период и количество занятий. finalAmount/discountAmount/balance
    // не трогаем здесь — их пересчитают recalcClientDiscounts + repriceSubscription
    // с учётом действующих скидок и (для pending) нулевой оплаты.
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        startDate: firstPaid,
        periodYear,
        periodMonth,
        totalLessons,
        totalAmount,
      },
    })

    // GroupEnrollment этого ребёнка в этой группе — двигаем дату зачисления на
    // новую дату старта (как при первичном переводе в «Ожидаем оплату»).
    const enrollment = await tx.groupEnrollment.findFirst({
      where: {
        tenantId,
        groupId: sub.groupId!,
        clientId: sub.clientId,
        wardId: sub.wardId,
        deletedAt: null,
      },
      orderBy: [{ isActive: "desc" }, { enrolledAt: "desc" }],
      select: { id: true },
    })
    if (enrollment) {
      await tx.groupEnrollment.update({
        where: { id: enrollment.id },
        data: { enrolledAt: firstPaid },
      })
    }

    // Витринная «дата 1-го платного» живёт на заявке (per-ребёнок), а не на
    // родителе: проставляем её активной заявке этого ребёнка в «Ожидаем оплату»
    // (приоритетно по направлению абонемента), затем пересчитываем агрегат
    // Client.firstPaidLessonDate для отчётов.
    const wardId = sub.wardId
    const directionId = sub.directionId
    const targetApp = wardId
      ? ((directionId
          ? await tx.application.findFirst({
              where: {
                tenantId,
                wardId,
                directionId,
                status: "active",
                deletedAt: null,
                stage: "awaiting_payment",
              },
              orderBy: { updatedAt: "desc" },
              select: { id: true },
            })
          : null) ??
        (await tx.application.findFirst({
          where: {
            tenantId,
            wardId,
            status: "active",
            deletedAt: null,
            stage: "awaiting_payment",
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        })))
      : null
    if (targetApp) {
      await tx.application.update({
        where: { id: targetApp.id },
        data: { firstPaidLessonDate: firstPaid },
      })
    }
    await recomputeClientFirstPaidLessonDate(tx, tenantId, sub.clientId)

    // Скидки v2: смена totalAmount могла изменить «самый дорогой в месяце»
    // (инвариант скидки за второй абонемент). Пересчёт корректирует источники
    // по месяцу клиента; затем repriceSubscription гарантирует, что суммы
    // именно этого абонемента отражают новое количество занятий, даже если его
    // собственная скидка не поменялась.
    await recalcClientDiscounts(tx, {
      tenantId,
      clientId: sub.clientId,
      createdBy: session.user.employeeId ?? null,
    })
    await repriceSubscription(tx, {
      tenantId,
      subscriptionId: sub.id,
      createdBy: session.user.employeeId ?? null,
    })

    return tx.subscription.findFirst({
      where: { id: sub.id },
      select: { id: true, totalLessons: true, finalAmount: true, balance: true },
    })
  })

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "update",
        entityType: "Subscription",
        entityId: sub.id,
        changes: {
          rescheduleStart: { new: parsed.data.firstPaidLessonDate },
          totalLessons: { new: totalLessons },
        },
      },
    })
  }

  return NextResponse.json({
    ok: true,
    totalLessons: result?.totalLessons ?? totalLessons,
    finalAmount: result ? Number(result.finalAmount) : Number(totalAmount),
  })
}
