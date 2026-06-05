import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const moveSchema = z.object({
  branchId: z.string().uuid("Выберите филиал"),
  directionId: z.string().uuid("Выберите направление"),
  groupId: z.string().uuid("Выберите группу"),
  firstPaidLessonDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
})

/**
 * Переход подопечного в стадию «Ожидаем оплату».
 *
 * Собирает 4 обязательных поля (филиал, направление, группа, дата первого
 * платного занятия) и атомарно:
 *  1) выписывает абонемент (pending),
 *  2) зачисляет в группу с paymentStatus='awaiting_payment',
 *  3) закрывает активную заявку,
 *  4) переводит Ward.salesStage в 'awaiting_payment'.
 *
 * Списание с баланса родителя не производится даже если денег достаточно —
 * оплата абонемента всегда ручная, через кнопку «Оплатить с баланса» в
 * карточке абонемента (POST /api/subscriptions/[id]/pay-from-balance).
 *
 * totalLessons рассчитывается как количество не отменённых занятий группы
 * с firstPaidLessonDate до конца месяца (включительно). Если занятия ещё не
 * сгенерированы — totalLessons=0; в этом случае админ должен сначала
 * сгенерировать расписание.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: wardId } = await params
  const body = await req.json()
  const parsed = moveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const data = parsed.data
  const tenantId = session.user.tenantId

  const ward = await db.ward.findFirst({
    where: { id: wardId, tenantId },
    select: { id: true, clientId: true, salesStage: true },
  })
  if (!ward) {
    return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })
  }

  // В awaiting_payment можно прийти из application или trial_attended.
  // Из none — нельзя (нет открытой заявки). Из awaiting_payment — уже там.
  // Из trial_scheduled — пусть сперва отметят пробное.
  if (
    ward.salesStage !== "application" &&
    ward.salesStage !== "trial_attended"
  ) {
    return NextResponse.json(
      {
        error:
          "Перевести в «Ожидание оплаты» можно только из «Заявка» или «Прошёл пробное».",
      },
      { status: 400 },
    )
  }

  const direction = await db.direction.findFirst({
    where: { id: data.directionId, tenantId, deletedAt: null },
    select: { id: true, lessonPrice: true },
  })
  if (!direction) {
    return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
  }

  const group = await db.group.findFirst({
    where: { id: data.groupId, tenantId, deletedAt: null },
    select: { id: true, branchId: true, directionId: true },
  })
  if (!group) {
    return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  }
  if (group.directionId !== data.directionId) {
    return NextResponse.json(
      { error: "Группа не относится к выбранному направлению" },
      { status: 400 },
    )
  }
  if (group.branchId !== data.branchId) {
    return NextResponse.json(
      { error: "Группа не относится к выбранному филиалу" },
      { status: 400 },
    )
  }

  const firstPaid = new Date(data.firstPaidLessonDate)
  const periodYear = firstPaid.getFullYear()
  const periodMonth = firstPaid.getMonth() + 1
  const monthStart = new Date(periodYear, periodMonth - 1, 1)
  const nextMonthStart = new Date(periodYear, periodMonth, 1)

  // Считаем занятия группы с firstPaidLessonDate до конца месяца —
  // именно за них клиент платит этим абонементом.
  const totalLessons = await db.lesson.count({
    where: {
      tenantId,
      groupId: data.groupId,
      date: { gte: firstPaid, lt: nextMonthStart },
      status: { in: ["scheduled", "completed"] },
    },
  })

  if (totalLessons === 0) {
    return NextResponse.json(
      {
        error:
          "В выбранном месяце у группы нет занятий. Сгенерируйте расписание группы.",
      },
      { status: 400 },
    )
  }

  // Запрет дублей абонементов (баг #52): подопечный не может получить второй
  // «живой» (pending/active) абонемент в ту же группу за тот же месяц.
  const duplicateSub = await db.subscription.findFirst({
    where: {
      tenantId,
      wardId: ward.id,
      groupId: data.groupId,
      periodYear,
      periodMonth,
      status: { in: ["pending", "active"] },
      deletedAt: null,
    },
    select: { id: true },
  })
  if (duplicateSub) {
    return NextResponse.json(
      { error: "У подопечного уже есть абонемент в эту группу на выбранный период." },
      { status: 409 },
    )
  }

  const lessonPrice = new Prisma.Decimal(direction.lessonPrice)
  const totalAmount = lessonPrice.mul(totalLessons)
  const finalAmount = totalAmount

  const now = new Date()

  const result = await db.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        tenantId,
        clientId: ward.clientId,
        wardId: ward.id,
        directionId: data.directionId,
        groupId: data.groupId,
        type: "calendar",
        status: "pending",
        periodYear,
        periodMonth,
        lessonPrice,
        totalLessons,
        totalAmount,
        discountAmount: new Prisma.Decimal(0),
        finalAmount,
        balance: finalAmount,
        startDate: firstPaid,
        createdBy: session.user.employeeId,
      },
    })

    // ADM-04: денормализуем филиал последнего абонемента.
    await tx.client.update({
      where: { id: ward.clientId },
      data: { lastBranchId: group.branchId },
    })

    // Выписка абонемента уменьшает баланс клиента на finalAmount (долг).
    await applyBalanceDelta(tx, {
      tenantId,
      clientId: ward.clientId,
      delta: finalAmount.negated(),
      type: "subscription_issued",
      refs: { subscriptionId: subscription.id, directionId: data.directionId },
      createdBy: session.user.employeeId,
    })

    // GroupEnrollment с awaiting_payment — это «у ребёнка занятия в группе,
    // но абонемент ещё не оплачен». В карточке занятия рядом с ФИО будет
    // флажок «Ожидаем оплату» (см. attendance-table.tsx).
    // Если уже есть зачисление в этой группе — обновляем (paymentStatus,
    // isActive); иначе создаём новое.
    const existingEnrollment = await tx.groupEnrollment.findFirst({
      where: {
        tenantId,
        groupId: data.groupId,
        clientId: ward.clientId,
        wardId: ward.id,
      },
    })
    if (existingEnrollment) {
      await tx.groupEnrollment.update({
        where: { id: existingEnrollment.id },
        data: {
          paymentStatus: "awaiting_payment",
          isActive: true,
          enrolledAt: existingEnrollment.enrolledAt || now,
        },
      })
    } else {
      await tx.groupEnrollment.create({
        data: {
          tenantId,
          groupId: data.groupId,
          clientId: ward.clientId,
          wardId: ward.id,
          paymentStatus: "awaiting_payment",
          isActive: true,
          enrolledAt: now,
        },
      })
    }

    // Закрываем активные заявки этого ребёнка.
    await tx.application.updateMany({
      where: { tenantId, wardId: ward.id, status: "active", deletedAt: null },
      data: {
        status: "processed",
        processedToStatus: "lead",
        processedAt: now,
        processedBy: session.user.employeeId ?? undefined,
      },
    })

    // Стадия — awaiting_payment. Автоактивация по балансу отключена:
    // оплата абонемента всегда ручная, через кнопку «Оплатить с баланса».
    await tx.ward.update({
      where: { id: ward.id },
      data: { salesStage: "awaiting_payment", salesStageAt: now },
    })

    return { subscription }
  })

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "update",
        entityType: "Ward",
        entityId: ward.id,
        changes: {
          salesStage: {
            old: ward.salesStage,
            new: "awaiting_payment",
          },
          subscriptionId: { new: result.subscription.id },
        },
      },
    })
  }

  return NextResponse.json({
    ok: true,
    subscriptionId: result.subscription.id,
  })
}
