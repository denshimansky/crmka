import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { calcRefund } from "@/lib/balance/calc-refund"
import { resolveRate } from "@/lib/salary/resolve-rate"
import { calcPay } from "@/lib/salary/calc-pay"
import { maybeRollbackPaidSalary } from "@/lib/salary/rollback-correction"
import { createMissedMakeupTask } from "@/lib/tasks/missed-makeup"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const markSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
  instructorPayEnabled: z.boolean().default(true),
  // Для типа makeup_scheduled — обязательно указать целевое занятие, на котором
  // ребёнок будет отрабатывать пропущенное.
  scheduledMakeupLessonId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
})

const bulkSchema = z.object({
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = markSchema.safeParse(body)
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
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // Проверка закрытия периода
  const role = (session.user as any).role
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Get attendance type
  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // Доступ роли к типу: педагог → availableToInstructor, админ → availableToAdmin.
  // Управляющий и владелец видят/ставят всё.
  if (role === "instructor" && !attendanceType.availableToInstructor) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен педагогу. Обратитесь к администратору.` },
      { status: 403 }
    )
  }
  if (role === "admin" && !attendanceType.availableToAdmin) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен администратору в этом центре.` },
      { status: 403 }
    )
  }

  // Валидация «Назначена отработка»: обязательное целевое занятие и проверка,
  // что ребёнок уже не отработал этот пропуск где-то ещё.
  let scheduledMakeupLessonId: string | null = data.scheduledMakeupLessonId
  if (attendanceType.code === "makeup_scheduled") {
    if (!scheduledMakeupLessonId) {
      return NextResponse.json(
        { error: "Для «Назначена отработка» нужно выбрать дату и занятие, где будет отработка" },
        { status: 400 }
      )
    }
    if (scheduledMakeupLessonId === lessonId) {
      return NextResponse.json(
        { error: "Целевое занятие отработки не может совпадать с текущим" },
        { status: 400 }
      )
    }
    const targetLesson = await db.lesson.findFirst({
      where: { id: scheduledMakeupLessonId, tenantId },
      select: { id: true },
    })
    if (!targetLesson) {
      return NextResponse.json({ error: "Целевое занятие не найдено" }, { status: 404 })
    }
    const alreadyMadeUp = await db.attendance.findFirst({
      where: {
        tenantId,
        makeupOfLessonId: lessonId,
        clientId: data.clientId,
        // chargeAmount > 0 — реальная отработка (Был), не «не пришёл».
        // Иначе админ не сможет переназначить отработку после «Не был».
        chargeAmount: { gt: 0 },
        ...(data.wardId ? { wardId: data.wardId } : {}),
      },
      select: { id: true },
    })
    if (alreadyMadeUp) {
      return NextResponse.json(
        { error: "Ребёнок уже отработал этот пропуск — назначать отработку повторно нельзя" },
        { status: 409 }
      )
    }
  } else {
    // Для всех остальных типов поле игнорируем — связь висит только на makeup_scheduled.
    scheduledMakeupLessonId = null
  }

  // Снятие/смена статуса «Назначена отработка» — только владелец.
  // Админ/менеджер не могут передумать за владельца, чтобы не было «незаметной»
  // отмены назначения и неожиданного списания.
  const existingForLockCheck = data.subscriptionId
    ? await db.attendance.findUnique({
        where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId: data.subscriptionId } },
        include: { attendanceType: { select: { code: true } } },
      })
    : await db.attendance.findFirst({
        where: { lessonId, tenantId, clientId: data.clientId, wardId: data.wardId, subscriptionId: null },
        include: { attendanceType: { select: { code: true } } },
      })
  if (
    existingForLockCheck &&
    existingForLockCheck.attendanceType.code === "makeup_scheduled" &&
    existingForLockCheck.attendanceTypeId !== data.attendanceTypeId &&
    role !== "owner"
  ) {
    return NextResponse.json(
      { error: "Снять «Назначена отработка» может только владелец" },
      { status: 403 }
    )
  }

  // Снятие отметки «Был» на отработке — только админ/управляющий/владелец.
  // Инструктор поставил отметку → за неё могла быть выплачена ЗП. Дальше
  // менять должен старший: он же отвечает за корректировку ведомостей.
  if (
    existingForLockCheck &&
    existingForLockCheck.isMakeup &&
    Number(existingForLockCheck.chargeAmount) > 0 &&
    attendanceType.code !== "present" &&
    role === "instructor"
  ) {
    return NextResponse.json(
      { error: "Снять «Был» на отработке может только админ, управляющий или владелец" },
      { status: 403 },
    )
  }

  // Ф7: Виртуальная отработка — на ЭТО занятие назначена отработка с другого
  // (более раннего) занятия. На L1 живёт Attendance с code=makeup_scheduled и
  // scheduledMakeupLessonId=текущему lessonId. Здесь, на L2, ребёнок появляется
  // как виртуальная строка. Педагог ставит «Был» (создаём реальную отработку,
  // списываем с абонемента L1) или «Не был» (задача админу переназначить).
  const virtualMakeup = await db.attendance.findFirst({
    where: {
      tenantId,
      clientId: data.clientId,
      wardId: data.wardId,
      scheduledMakeupLessonId: lessonId,
      attendanceType: { code: "makeup_scheduled" },
    },
    include: {
      lesson: {
        select: {
          id: true,
          date: true,
          group: { select: { direction: { select: { name: true } } } },
        },
      },
      client: { select: { firstName: true, lastName: true } },
    },
  })
  // Ward не имеет relation в Attendance — подгружаем отдельно, если нужно.
  const virtualMakeupWard = virtualMakeup?.wardId
    ? await db.ward.findUnique({
        where: { id: virtualMakeup.wardId },
        select: { firstName: true, lastName: true },
      })
    : null
  const isMakeupArrival = !!virtualMakeup
  const sourceMakeupLessonId = virtualMakeup?.lesson.id ?? null

  if (isMakeupArrival) {
    if (attendanceType.code !== "present" && attendanceType.code !== "no_show") {
      return NextResponse.json(
        { error: "На отработке доступны только «Был» или «Не был»" },
        { status: 400 },
      )
    }
    // Переключаем subscriptionId на исходное (L1) — списания/откаты пойдут
    // с абонемента группы пропущенного занятия, а не текущей.
    data.subscriptionId = virtualMakeup.subscriptionId
  }

  // Fetch org setting for trial lesson instructor pay
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { payForTrialLessons: true },
  })

  // === Вся бизнес-логика в транзакции ===
  const attendance = await db.$transaction(async (tx) => {
    // Ф8: Отмена отработки. «Не был» на L2-виртуальной отработке = отработка
    // не состоялась. Возвращаем оба занятия к «не отмечено»: удаляем запись
    // `makeup_scheduled` на L1 и (если уже была) реальную отметку на L2.
    // Откаты списания / refund / ЗП — здесь же, чтобы не оставлять «осиротевших»
    // транзакций в балансе.
    if (isMakeupArrival && attendanceType.code === "no_show") {
      const existingOnL2 = data.subscriptionId
        ? await tx.attendance.findUnique({
            where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId: data.subscriptionId } },
            include: { attendanceType: { select: { chargePercent: true } } },
          })
        : null

      if (existingOnL2) {
        if (Number(existingOnL2.chargeAmount) > 0) {
          const prevRefund = calcRefund(existingOnL2.chargeAmount, existingOnL2.attendanceType.chargePercent)
          if (prevRefund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: data.clientId,
              delta: prevRefund.negated(),
              type: "attendance_revert",
              refs: { lessonId, attendanceId: existingOnL2.id, directionId: lesson.group.directionId },
              createdBy: employeeId,
            })
          }
          if (existingOnL2.subscriptionId) {
            await tx.subscription.update({
              where: { id: existingOnL2.subscriptionId },
              data: {
                balance: { increment: existingOnL2.chargeAmount },
                chargedAmount: { decrement: existingOnL2.chargeAmount },
              },
            })
          }
        }
        if (Number(existingOnL2.instructorPayAmount) > 0) {
          const effInstructorId = lesson.substituteInstructorId || lesson.instructorId
          if (effInstructorId) {
            await maybeRollbackPaidSalary(tx, {
              tenantId,
              employeeId: effInstructorId,
              lessonDate: new Date(lesson.date),
              amount: existingOnL2.instructorPayAmount,
              createdBy: employeeId,
              comment: `Отмена отработки на занятии ${new Date(lesson.date).toLocaleDateString("ru-RU")}`,
            })
          }
        }
        await tx.attendance.delete({ where: { id: existingOnL2.id } })
      }
      if (virtualMakeup) {
        await tx.attendance.delete({ where: { id: virtualMakeup.id } })
      }
      return null
    }

    // Calculate charge amount
    let chargeAmount = new Prisma.Decimal(0)
    let subscriptionId = data.subscriptionId

    if (attendanceType.chargesSubscription && subscriptionId) {
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, tenantId, deletedAt: null, status: { in: ["active", "pending"] } },
      })
      if (subscription) {
        chargeAmount = subscription.lessonPrice
      }
    } else if (attendanceType.chargesSubscription && !subscriptionId) {
      const lessonDate = new Date(lesson.date)
      const subscription = await tx.subscription.findFirst({
        where: {
          tenantId,
          clientId: data.clientId,
          groupId: lesson.groupId,
          periodYear: lessonDate.getFullYear(),
          periodMonth: lessonDate.getMonth() + 1,
          deletedAt: null,
          status: { in: ["active", "pending"] },
          ...(data.wardId ? { wardId: data.wardId } : {}),
        },
      })
      if (subscription) {
        subscriptionId = subscription.id
        chargeAmount = subscription.lessonPrice
      }
    }

    // Calculate instructor pay через единые утилиты resolve-rate + calc-pay
    let instructorPayAmount = new Prisma.Decimal(0)
    if (attendanceType.paysInstructor && data.instructorPayEnabled) {
      const rate = await resolveRate(tx, {
        tenantId,
        groupId: lesson.groupId,
        employeeId: lesson.substituteInstructorId || lesson.instructorId,
        directionId: lesson.group.directionId,
      })
      if (rate) {
        instructorPayAmount = await calcPay(tx, {
          rate,
          lessonId,
          tenantId,
          currentClientId: data.clientId,
          currentChargeAmount: chargeAmount,
        })
      }
    }

    // Trial lesson instructor pay logic:
    // - Setting OFF → never pay for trials
    // - Setting ON → pay only if chargeAmount > 0 (paid trial)
    if (lesson.isTrial && Number(instructorPayAmount) > 0) {
      if (!org?.payForTrialLessons || Number(chargeAmount) === 0) {
        instructorPayAmount = new Prisma.Decimal(0)
      }
    }

    // Upsert attendance
    let att
    if (subscriptionId) {
      const existing = await tx.attendance.findUnique({
        where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId } },
        include: { attendanceType: { select: { chargePercent: true } } },
      })

      // Откат предыдущего возврата (lesson_refund) при смене типа посещения
      if (existing && Number(existing.chargeAmount) > 0) {
        const prevRefund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
        if (prevRefund.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: data.clientId,
            delta: prevRefund.negated(),
            type: "attendance_revert",
            refs: { lessonId, attendanceId: existing.id, directionId: lesson.group.directionId },
            createdBy: employeeId,
          })
        }
      }

      if (existing) {
        // Reverse previous charge
        if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: existing.subscriptionId },
            data: {
              balance: { increment: existing.chargeAmount },
              chargedAmount: { decrement: existing.chargeAmount },
            },
          })
        }

        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }

      // Debit subscription
      if (attendanceType.chargesSubscription && Number(chargeAmount) > 0) {
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            balance: { decrement: chargeAmount },
            chargedAmount: { increment: chargeAmount },
          },
        })

        // Возврат недосписанной части на баланс клиента при chargePercent < 100
        const refund = calcRefund(chargeAmount, attendanceType.chargePercent)
        if (refund.gt(0)) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: data.clientId,
            delta: refund,
            type: "lesson_refund",
            refs: { lessonId, attendanceId: att.id, directionId: lesson.group.directionId, subscriptionId },
            createdBy: employeeId,
          })
        }

        // Lead→Client conversion: первое платное посещение конвертирует лида
        const client = await tx.client.findUnique({ where: { id: data.clientId } })
        if (client && client.funnelStatus !== "active_client" && client.clientStatus !== "active") {
          await tx.client.update({
            where: { id: data.clientId },
            data: {
              funnelStatus: "active_client",
              clientStatus: "active",
            },
          })
        }
      }
    } else {
      // No subscription
      const existing = await tx.attendance.findFirst({
        where: {
          lessonId,
          clientId: data.clientId,
          wardId: data.wardId,
          subscriptionId: null,
        },
      })

      if (existing) {
        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId: null,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            scheduledMakeupLessonId,
            isMakeup: isMakeupArrival,
            makeupOfLessonId: sourceMakeupLessonId,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }
    }

    return att
  })

  if (attendance) {
    logAudit({
      tenantId,
      employeeId,
      action: "create",
      entityType: "Attendance",
      entityId: attendance.id,
      changes: { lessonId: { new: lessonId }, clientId: { new: data.clientId }, attendanceTypeId: { new: data.attendanceTypeId } },
      req,
    })
  } else if (virtualMakeup) {
    // Отработка отменена — фиксируем удаление записи makeup_scheduled на L1.
    logAudit({
      tenantId,
      employeeId,
      action: "delete",
      entityType: "Attendance",
      entityId: virtualMakeup.id,
      changes: { reason: { new: "makeup_cancelled" }, targetLessonId: { new: lessonId } },
      req,
    })
  }

  // Ф7: «Не был» на виртуальной отработке — создаём задачу админу переназначить.
  if (isMakeupArrival && attendanceType.code === "no_show" && virtualMakeup) {
    const wardName = virtualMakeupWard
      ? [virtualMakeupWard.lastName, virtualMakeupWard.firstName].filter(Boolean).join(" ")
      : ""
    const clientName = [virtualMakeup.client.lastName, virtualMakeup.client.firstName].filter(Boolean).join(" ")
    const childDisplayName = wardName || clientName || "Без имени"
    await createMissedMakeupTask(db, {
      tenantId,
      clientId: data.clientId,
      childDisplayName,
      sourceLessonDate: virtualMakeup.lesson.date,
      sourceDirectionName: virtualMakeup.lesson.group.direction.name,
      targetLessonDate: new Date(lesson.date),
      targetDirectionName: lesson.group.direction.name,
      reason: "no_show",
    })
  }

  return NextResponse.json(attendance)
}

// PUT: Mark ALL students as present (bulk)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const role = (session.user as any).role

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: { include: { direction: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: parsed.data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // Доступ роли к типу: педагог → availableToInstructor, админ → availableToAdmin.
  // Управляющий и владелец видят/ставят всё.
  if (role === "instructor" && !attendanceType.availableToInstructor) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен педагогу. Обратитесь к администратору.` },
      { status: 403 }
    )
  }
  if (role === "admin" && !attendanceType.availableToAdmin) {
    return NextResponse.json(
      { error: `Тип «${attendanceType.name}» не доступен администратору в этом центре.` },
      { status: 403 }
    )
  }

  // Проверка закрытия периода
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Get all active enrollments
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
  })

  // Get subscriptions for this period
  const lessonDate = new Date(lesson.date)
  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      groupId: lesson.groupId,
      periodYear: lessonDate.getFullYear(),
      periodMonth: lessonDate.getMonth() + 1,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
  })

  // Резолв ставки ЗП через единую утилиту: приоритет — GroupSalaryRate
  // группы → личное исключение по направлению → дефолт педагога.
  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const resolvedRate = await resolveRate(db, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  })

  // Fetch org setting for trial lesson instructor pay
  const orgBulk = await db.organization.findUnique({
    where: { id: tenantId },
    select: { payForTrialLessons: true },
  })

  // === Предзагрузка existing attendances (batch вместо N+1) ===
  const existingAttendances = await db.attendance.findMany({
    where: { lessonId, tenantId },
    include: { attendanceType: { select: { chargePercent: true, code: true } } },
  })

  // Ученики, у которых пропуск этого Lesson уже отработан в другой группе:
  // их при «Отметить всех» отмечаем как «Отработано» (без списания, без ЗП), а
  // не «Явка» — иначе будет двойное списание.
  // chargeAmount > 0 — учитываем только успешные отработки (Был на L2).
  // «Не пришёл на отработку» (chargeAmount=0) bulk не должен интерпретировать
  // как «уже отработано», иначе при «Отметить всех — Явка» система ошибочно
  // поставит этим ученикам тип «Отработка» без списания.
  const madeUpResolutions = await db.attendance.findMany({
    where: { tenantId, makeupOfLessonId: lessonId, chargeAmount: { gt: 0 } },
    select: { wardId: true, clientId: true },
  })
  const madeUpKeys = new Set(
    madeUpResolutions.map((m) => `${m.clientId}:${m.wardId || ""}`),
  )
  const makeupType = madeUpKeys.size
    ? await db.attendanceType.findFirst({
        where: { code: "makeup", OR: [{ tenantId: null }, { tenantId }], isActive: true },
      })
    : null

  // === Вся bulk-логика в одной транзакции ===
  const results = await db.$transaction(async (tx) => {
    const atts = []

    for (const enrollment of enrollments) {
      const subscription = subscriptions.find(
        (s) => s.clientId === enrollment.clientId && (
          enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
        )
      )

      // Если у ученика уже стоит «Назначена отработка» — bulk не перетирает,
      // чтобы случайно не отменить назначение и не списать дважды (списание
      // произойдёт когда ребёнок реально придёт на целевое занятие).
      const existingForEnrollment = existingAttendances.find(
        (a) => a.clientId === enrollment.clientId && a.wardId === enrollment.wardId
      )
      if (existingForEnrollment && existingForEnrollment.attendanceType.code === "makeup_scheduled") {
        continue
      }

      // Если этот пропуск уже отработан в другой группе — отмечаем как
      // «Отработано» (chargesSubscription=false, paysInstructor=false).
      const enrollmentKey = `${enrollment.clientId}:${enrollment.wardId || ""}`
      const isAlreadyMadeUp = madeUpKeys.has(enrollmentKey) && !!makeupType
      const effectiveType = isAlreadyMadeUp ? makeupType! : attendanceType

      let chargeAmount = new Prisma.Decimal(0)
      if (effectiveType.chargesSubscription && subscription) {
        chargeAmount = subscription.lessonPrice
      }

      let instructorPayAmount = new Prisma.Decimal(0)
      if (effectiveType.paysInstructor && resolvedRate) {
        instructorPayAmount = await calcPay(tx, {
          rate: resolvedRate,
          lessonId,
          tenantId,
          currentClientId: enrollment.clientId,
          currentChargeAmount: chargeAmount,
        })
      }

      // Trial lesson instructor pay logic (same as single attendance)
      if (lesson.isTrial && Number(instructorPayAmount) > 0) {
        if (!orgBulk?.payForTrialLessons || Number(chargeAmount) === 0) {
          instructorPayAmount = new Prisma.Decimal(0)
        }
      }

      const subscriptionId = subscription?.id || null

      if (subscriptionId) {
        // Ищем в предзагруженных (вместо N отдельных запросов)
        const existing = existingAttendances.find(
          (a) => a.subscriptionId === subscriptionId
        )

        // Откат предыдущего возврата (lesson_refund) при смене типа
        if (existing && Number(existing.chargeAmount) > 0) {
          const prevRefund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
          if (prevRefund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: enrollment.clientId,
              delta: prevRefund.negated(),
              type: "attendance_revert",
              refs: { lessonId, attendanceId: existing.id, directionId: lesson.group.directionId },
              createdBy: employeeId,
            })
          }
        }

        let att
        if (existing) {
          // Reverse previous charge
          if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
            await tx.subscription.update({
              where: { id: existing.subscriptionId },
              data: {
                balance: { increment: existing.chargeAmount },
                chargedAmount: { decrement: existing.chargeAmount },
              },
            })
          }

          att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              attendanceTypeId: effectiveType.id,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        } else {
          att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: effectiveType.id,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
        }
        atts.push(att)

        // Debit subscription
        if (effectiveType.chargesSubscription && Number(chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: {
              balance: { decrement: chargeAmount },
              chargedAmount: { increment: chargeAmount },
            },
          })

          // Возврат недосписанной части при chargePercent < 100
          const refund = calcRefund(chargeAmount, effectiveType.chargePercent)
          if (refund.gt(0)) {
            await applyBalanceDelta(tx, {
              tenantId,
              clientId: enrollment.clientId,
              delta: refund,
              type: "lesson_refund",
              refs: { lessonId, attendanceId: att.id, directionId: lesson.group.directionId, subscriptionId },
              createdBy: employeeId,
            })
          }
        }
      } else {
        // No subscription — ищем в предзагруженных
        const existing = existingAttendances.find(
          (a) => a.clientId === enrollment.clientId &&
            a.wardId === enrollment.wardId &&
            a.subscriptionId === null
        )

        if (existing) {
          const att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              attendanceTypeId: effectiveType.id,
              chargeAmount: 0,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        } else {
          const att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId: null,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: effectiveType.id,
              chargeAmount: 0,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        }
      }
    }

    return atts
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: lessonId,
    changes: { bulk: { new: true }, count: { new: results.length }, attendanceTypeId: { new: parsed.data.attendanceTypeId } },
    req,
  })

  return NextResponse.json({ count: results.length, attendances: results })
}

// DELETE: Сбросить отметку — вернуть строку в состояние «Не отмечен».
// Удаляет Attendance, откатывает списание с абонемента (если было).
// Принимает либо attendanceId, либо (clientId + wardId) — для поиска по ученику.
const deleteSchema = z.object({
  attendanceId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  wardId: z.string().uuid().nullable().optional(),
}).refine((d) => d.attendanceId || d.clientId, {
  message: "Нужен attendanceId или clientId",
})

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId
  const role = (session.user as any).role

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: { id: true, date: true, instructorId: true, substituteInstructorId: true },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  const existing = data.attendanceId
    ? await db.attendance.findFirst({
        where: { id: data.attendanceId, lessonId, tenantId },
        include: {
          attendanceType: { select: { chargePercent: true } },
          lesson: { select: { group: { select: { directionId: true } } } },
        },
      })
    : await db.attendance.findFirst({
        where: {
          lessonId,
          tenantId,
          clientId: data.clientId,
          wardId: data.wardId ?? null,
        },
        include: {
          attendanceType: { select: { chargePercent: true } },
          lesson: { select: { group: { select: { directionId: true } } } },
        },
      })

  if (!existing) return NextResponse.json({ error: "Отметка не найдена" }, { status: 404 })

  // Пробное (isTrial=true) сбрасывается через /api/trial-lessons/[id] — там своя логика
  if (existing.isTrial) {
    return NextResponse.json(
      { error: "Снимите отметку пробного через выпадашку статуса пробного" },
      { status: 400 }
    )
  }

  // Снятие отметки «Был» на отработке — только админ+.
  // ЗП могла быть уже выплачена педагогу; решение об откате принимает старший.
  if (
    existing.isMakeup &&
    Number(existing.chargeAmount) > 0 &&
    role === "instructor"
  ) {
    return NextResponse.json(
      { error: "Снять отметку «Был» на отработке может только админ, управляющий или владелец" },
      { status: 403 },
    )
  }

  await db.$transaction(async (tx) => {
    // Откат списания с абонемента
    if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
      await tx.subscription.update({
        where: { id: existing.subscriptionId },
        data: {
          balance: { increment: existing.chargeAmount },
          chargedAmount: { decrement: existing.chargeAmount },
        },
      })
    }

    // Откат возврата (lesson_refund) на баланс клиента
    if (Number(existing.chargeAmount) > 0) {
      const refund = calcRefund(existing.chargeAmount, existing.attendanceType.chargePercent)
      if (refund.gt(0)) {
        await applyBalanceDelta(tx, {
          tenantId,
          clientId: existing.clientId,
          delta: refund.negated(),
          type: "attendance_revert",
          refs: {
            lessonId,
            attendanceId: existing.id,
            directionId: existing.lesson.group.directionId,
            subscriptionId: existing.subscriptionId,
          },
          createdBy: employeeId,
        })
      }
    }

    // Ф-аудит: если педагогу уже выплатили ЗП за этот период, компенсируем
    // удаление через SalaryAdjustment, иначе у него «висит» переплата.
    if (Number(existing.instructorPayAmount) > 0) {
      const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
      await maybeRollbackPaidSalary(tx, {
        tenantId,
        employeeId: effectiveInstructorId,
        lessonDate: new Date(lesson.date),
        amount: existing.instructorPayAmount,
        createdBy: employeeId,
        comment: `Удалена отметка от ${new Date(lesson.date).toLocaleDateString("ru-RU")}`,
      })
    }

    await tx.attendance.delete({ where: { id: existing.id } })
  })

  logAudit({
    tenantId,
    employeeId,
    action: "delete",
    entityType: "Attendance",
    entityId: existing.id,
    changes: {
      lessonId: { old: lessonId },
      clientId: { old: existing.clientId },
      attendanceTypeId: { old: existing.attendanceTypeId },
    },
    req,
  })

  return NextResponse.json({ ok: true })
}

// PATCH: Update absence reason on an attendance record
const patchSchema = z.object({
  attendanceId: z.string().uuid(),
  absenceReasonId: z.string().uuid().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.attendance.findFirst({
    where: { id: parsed.data.attendanceId, lessonId, tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Отметка не найдена" }, { status: 404 })

  const updated = await db.attendance.update({
    where: { id: parsed.data.attendanceId },
    data: { absenceReasonId: parsed.data.absenceReasonId },
  })

  return NextResponse.json(updated)
}
