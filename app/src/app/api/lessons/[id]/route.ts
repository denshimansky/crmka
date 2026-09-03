import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  rosterWhereOnDate,
  effectiveRosterDate,
  coverageSubscriptionsWhere,
  coverageKeysOnDate,
  coverageKey,
} from "@/lib/subscriptions/roster-filter"
import { consumedPackageLessonsMap, pickChargeableSubscription } from "@/lib/subscriptions/package-remaining"
import { getAttendanceTypeOverrideMap, applyAttendanceOverride } from "@/lib/subscriptions/withdrawal-block"
import { z } from "zod"
import { isPeriodLocked } from "@/lib/period-check"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { calcRefund } from "@/lib/balance/calc-refund"
import { logAudit } from "@/lib/audit"
import { archiveDeletedLesson } from "@/lib/schedule/deleted-lessons"
import { createMissedMakeupTask } from "@/lib/tasks/missed-makeup"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"
import {
  branchScopeFromSession,
  canAccessBranch,
  canAccessLessonAsInstructor,
} from "@/lib/branch-scope"

// ADM-04: общая проверка доступа к занятию.
// Возвращает 403, если у роли нет права читать/писать это занятие.
async function checkLessonAccess(
  lessonId: string,
  tenantId: string,
  role: string,
  employeeId: string,
  allowedBranchIds: string[] | null | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      instructorId: true,
      substituteInstructorId: true,
      group: { select: { branchId: true } },
    },
  })
  if (!lesson) return { ok: false, status: 404, error: "Занятие не найдено" }
  const scope = branchScopeFromSession(allowedBranchIds)
  if (role === "instructor") {
    if (!canAccessLessonAsInstructor(lesson, employeeId)) {
      return { ok: false, status: 403, error: "Нет доступа к этому занятию" }
    }
  } else if (!canAccessBranch(lesson.group.branchId, scope)) {
    return { ok: false, status: 403, error: "Нет доступа к филиалу этого занятия" }
  }
  return { ok: true }
}

// Отсутствующее в body поле обязано остаться undefined («не трогаем»), а не
// схлопываться в null: иначе любой частичный PATCH (замена инструктора, отмена,
// перенос, сохранение только темы) затирал остальные текстовые поля в NULL.
const optionalTrimmed = z.any().transform(v => {
  if (v === undefined) return undefined
  return (typeof v === "string" && v.trim()) ? v.trim() : null
})

const updateSchema = z.object({
  topic: optionalTrimmed,
  homework: optionalTrimmed,
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
  cancelReason: optionalTrimmed,
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
  // Подтверждение отмены занятия, на которое записаны пробные: они останутся
  // без занятия, каждому ставится задача «Переназначить пробное».
  confirmTrialsLoseLesson: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId
  const role = (session.user as any).role
  const employeeId = (session.user as any).employeeId
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined

  const access = await checkLessonAccess(id, tenantId, role, employeeId, allowedBranchIds)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

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

  // Дата состава: для перенесённого занятия — исходная дата (rescheduledFromDate),
  // иначе текущая. Так перенос на более поздний день не затягивает учеников,
  // начавших заниматься позже исходной даты.
  const rosterDate = effectiveRosterDate(lesson)

  // Состав занятия. Дата = граница состава: ученик виден в занятиях ПО дату
  // отчисления включительно и пропадает в более поздних. Поэтому берём активных
  // (withdrawnAt IS NULL) И отчисленных/переведённых ПОЗЖЕ даты занятия
  // (withdrawnAt > date; при отчислении withdrawnAt = последнее платное + 1).
  // isActive=false без withdrawnAt не бывает (все деактивации ставят isActive),
  // поэтому второй ветке нужен isActive=true.
  const enrollmentsRaw = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      deletedAt: null,
      ...rosterWhereOnDate(rosterDate),
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // Кандидаты в покрывающие абонементы — по направлению занятия (перевод между
  // группами не переносит groupId абонемента). Период — по дате состава
  // (rosterDate): для перенесённого через границу месяца занятия абонемент
  // ищется в исходном месяце, а не в новом.
  const subscriptionsAll = await db.subscription.findMany({
    where: coverageSubscriptionsWhere({
      tenantId,
      directionIds: [lesson.group.directionId],
      from: rosterDate,
    }),
    select: {
      id: true,
      groupId: true,
      clientId: true,
      wardId: true,
      lessonPrice: true,
      discountPerLesson: true,
      balance: true,
      chargedAmount: true,
      totalLessons: true,
      startDate: true,
      type: true,
      status: true,
      periodYear: true,
      periodMonth: true,
      expiresAt: true,
    },
  })
  // Для цены/привязки — как раньше: живые абонементы ЭТОЙ группы.
  const subscriptions = subscriptionsAll.filter(
    (s) => s.groupId === lesson.groupId && (s.status === "active" || s.status === "pending"),
  )
  // Пакет к списанию — FIFO по остатку занятий (полностью оплаченный тоже).
  const routeConsumedById = await consumedPackageLessonsMap(
    db,
    tenantId,
    subscriptions.filter((s) => s.type === "package").map((s) => s.id),
    lesson.id,
  )

  // Зачисление даёт место в составе, только если есть покрывающий абонемент на
  // дату состава (правило — см. roster-filter.ts). enrolledAt не участвует:
  // границу начала задаёт startDate абонемента.
  const coveredKeys = await coverageKeysOnDate(db, tenantId, subscriptionsAll, rosterDate, lesson.id)
  const enrollments = enrollmentsRaw.filter((e) =>
    coveredKeys.has(coverageKey(e.clientId, e.wardId)),
  )

  // Get available attendance types (system + tenant-specific). Пер-орг оверрайд
  // (баг #82): убираем отключённые типы и берём эффективный доступ роли центра.
  const typeOverrideMap = await getAttendanceTypeOverrideMap(db, tenantId)
  const attendanceTypes = (await db.attendanceType.findMany({
    where: {
      OR: [
        { tenantId: null },
        { tenantId },
      ],
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  }))
    .map((t) => applyAttendanceOverride(t, typeOverrideMap.get(t.id)))
    .filter((t) => !t.isDisabledForTenant)

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

    const subscription = pickChargeableSubscription(
      subscriptions.filter(
        (s) => s.clientId === enrollment.clientId && (
          enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
        )
      ),
      routeConsumedById,
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
      // Скидки v2: сумма предстоящего списания = эффективная цена занятия.
      lessonPrice: subscription
        ? Math.max(0, Number(subscription.lessonPrice) - Number(subscription.discountPerLesson ?? 0))
        : Number(lesson.group.direction.lessonPrice),
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
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined

  const access = await checkLessonAccess(id, tenantId, role, employeeId, allowedBranchIds)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

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

    // Наложения при переносе разрешены НАМЕРЕННО: партнёрам часто нужно
    // переносить занятия свободно (для аналитики), поэтому проверка занятости
    // кабинета/инструктора здесь не выполняется. Запрет на наложение остаётся
    // только при создании разового занятия и создании/переносе индивидуального
    // пробного (см. lib/schedule/room-conflict → standalone-lessons, trial-lesson).
  }

  // ── Отмена занятия с записанными пробными ──
  // Удаление занятия с активными пробными этот роут запрещает, а отмена раньше
  // не проверяла ничего: занятие уходило из сетки, и пробное оставалось висеть
  // без занятия (отменить его на карточке занятия нельзя — только в «Продажах»).
  // Отмена обратима, поэтому не запрещаем, а требуем подтверждения и ставим
  // задачу на переназначение — как уже сделано для отработок ниже.
  let trialsLosingLesson: Array<{
    id: string
    clientId: string
    childName: string
  }> = []
  if (data.status === "cancelled" && existing.status !== "cancelled") {
    const rows = await db.trialLesson.findMany({
      where: { lessonId: id, tenantId, status: "scheduled" },
      select: {
        id: true,
        clientId: true,
        client: { select: { firstName: true, lastName: true } },
        ward: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "asc" },
    })
    trialsLosingLesson = rows.map((t) => ({
      id: t.id,
      clientId: t.clientId,
      childName:
        [t.ward?.lastName, t.ward?.firstName].filter(Boolean).join(" ") ||
        [t.client.lastName, t.client.firstName].filter(Boolean).join(" ") ||
        "Без имени",
    }))
    if (trialsLosingLesson.length > 0 && !data.confirmTrialsLoseLesson) {
      return NextResponse.json(
        {
          error:
            `На занятие записаны пробные (${trialsLosingLesson.length}): ` +
            `${trialsLosingLesson.map((t) => t.childName).join(", ")}. ` +
            `После отмены они останутся без занятия — перенесите их в «Продажах» ` +
            `или подтвердите отмену, и на каждого появится задача «Переназначить пробное».`,
          requiresTrialConfirmation: true,
          trials: trialsLosingLesson.map((t) => t.childName),
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
  if (data.date !== undefined) {
    updateData.date = newDate
    // Замораживаем исходную дату для расчёта состава занятия. Ставим ОДИН раз —
    // при первом переносе на другой день — и больше не трогаем (храним самую
    // первую дату; повторные переносы и возврат на исходную её не меняют).
    // Сравниваем по времени (обе даты — полночь UTC, @db.Date): смена только
    // времени/длительности день не меняет, поле не ставим.
    if (
      existing.rescheduledFromDate === null &&
      newDate.getTime() !== existing.date.getTime()
    ) {
      updateData.rescheduledFromDate = existing.date
    }
  }
  if (data.startTime !== undefined) updateData.startTime = newStartTime
  if (data.durationMinutes !== undefined) updateData.durationMinutes = newDurationMinutes

  // ── Транзакция: откат отметок (если перенос с подтверждением) + апдейт занятия ──
  const lesson = await db.$transaction(async (tx) => {
    if (isMove && attendancesCount > 0) {
      const attendances = await tx.attendance.findMany({
        where: { lessonId: id, tenantId },
        include: { attendanceType: { select: { chargePercent: true } } },
      })

      // Затронутые абонементы — для пересчёта finalAmount/balance после отката.
      const touchedSubIds = new Set<string>()
      for (const att of attendances) {
        if (att.subscriptionId) touchedSubIds.add(att.subscriptionId)
        // Откат списания с абонемента. balance вручную НЕ трогаем: он живёт по
        // инварианту balance = finalAmount − paid и выравнивается reprice ниже
        // (ручной increment конфликтовал с пересчётом и портил legacy-абонементы,
        // у которых отметка баланс вообще не меняет).
        if (att.subscriptionId && Number(att.chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: att.subscriptionId },
            data: {
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
        // Откат разового списания с баланса родителя (отметка без абонемента):
        // раньше перенос удалял отметку, а personal_lesson_charge оставался —
        // фантомный минус на балансе.
        if (!att.subscriptionId && !att.isPending && Number(att.chargeAmount) > 0) {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: att.clientId,
            delta: att.chargeAmount,
            type: "attendance_revert",
            refs: { lessonId: id, attendanceId: att.id, directionId: existing.group.directionId },
            createdBy: employeeId,
            comment: "Перенос занятия — возврат за разовое посещение",
          })
        }
        if (!att.subscriptionId && !att.isTrial && !att.isMakeup) {
          // Разовый ученик остаётся в составе перенесённого занятия —
          // возвращаем отметку в placeholder («Не отмечен»), как при сбросе отметки.
          await tx.attendance.update({
            where: { id: att.id },
            data: { isPending: true, chargeAmount: 0, instructorPayAmount: 0, markedBy: null, markedAt: null },
          })
        } else {
          await tx.attendance.delete({ where: { id: att.id } })
        }
      }

      // Пересчёт затронутых абонементов ПОСЛЕ удаления всех отметок: занятия
      // вернулись в «оставшиеся» (включая израсходованные без списания
      // Уваж. пропуск/Перерасчёт) — выравниваем finalAmount/balance.
      for (const sid of touchedSubIds) {
        await repriceSubscription(tx, {
          tenantId,
          subscriptionId: sid,
          createdBy: employeeId,
        })
      }
    }

    // Перенос сбросил отметки — пробные «Пришёл» тоже возвращаем в «Не отмечен»
    // вместе с этапом заявки и зеркалом Ward.salesStage (Attendance и деньги
    // откатил цикл выше). Иначе пробное остаётся «Пришёл» без отметки, а в
    // воронке ребёнок числится прошедшим пробное, которого больше нет.
    if (isMove && attendancesCount > 0) {
      const { revertAttendedTrialsOnLessonMove } = await import(
        "@/lib/services/revert-trial-marks"
      )
      await revertAttendedTrialsOnLessonMove(tx, { tenantId, lessonId: id })
    }

    // Перенос двигает и записанные на занятие пробные. У TrialLesson своя копия
    // даты (scheduledDate) — по ней живут воронка «Продажи», вкладка
    // «Расписание» в карточке клиента и задачи-напоминания. Без синхронизации
    // занятие уезжало, а пробное продолжало показывать старую дату (ссылка при
    // этом уже вела в перенесённое занятие).
    if (isMove && data.date !== undefined) {
      await tx.trialLesson.updateMany({
        where: { lessonId: id, tenantId, status: { not: "cancelled" } },
        data: { scheduledDate: newDate },
      })
    }
    // Время и длительность есть только у ИНДИВИДУАЛЬНОГО пробного (у группового
    // они null — время берётся от занятия группы). Двигаем их вместе с его
    // занятием-держателем.
    if (isMove && (data.startTime !== undefined || data.durationMinutes !== undefined)) {
      await tx.trialLesson.updateMany({
        where: {
          lessonId: id,
          tenantId,
          status: { not: "cancelled" },
          startTime: { not: null },
        },
        data: {
          ...(data.startTime !== undefined ? { startTime: newStartTime } : {}),
          ...(data.durationMinutes !== undefined
            ? { durationMinutes: newDurationMinutes }
            : {}),
        },
      })
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

    // Пробные, потерявшие занятие: задача админу переназначить. Сами пробные
    // не трогаем — отмену/перенос записи делают в «Продажах», где заявка
    // двигается по воронке вместе с пробным.
    if (trialsLosingLesson.length > 0) {
      const { createReassignTrialTask } = await import("@/lib/tasks/reassign-trial")
      for (const trial of trialsLosingLesson) {
        await createReassignTrialTask(db, {
          tenantId,
          clientId: trial.clientId,
          childDisplayName: trial.childName,
          lessonDate: new Date(existing.date),
          lessonStartTime: existing.startTime,
          directionName: targetDirection?.name ?? "—",
          groupName: existing.group.name,
        })
      }
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
  const employeeId = (session.user as any).employeeId
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined

  const access = await checkLessonAccess(id, tenantId, role, employeeId, allowedBranchIds)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const lesson = await db.lesson.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      date: true,
      groupId: true,
      status: true,
      // Остальные поля — снимок в архив удалённых (см. DeletedLesson).
      startTime: true,
      durationMinutes: true,
      instructorId: true,
      substituteInstructorId: true,
      isTrial: true,
      isMakeup: true,
      cancelReason: true,
      topic: true,
      homework: true,
      rescheduledFromDate: true,
      _count: {
        select: {
          // Реальные отметки блокируют удаление. Placeholder (isPending=true)
          // удаляются автоматически вместе с занятием.
          attendances: { where: { isPending: false } },
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
      { error: "К занятию привязаны активные пробные. Сначала перенесите или отмените их в «Продажах» (вкладка «Пробное»)." },
      { status: 400 }
    )
  }

  // Отвяжем отменённые пробные от занятия, чтобы FK не блокировал удаление
  await db.trialLesson.updateMany({
    where: { lessonId: id, status: "cancelled" },
    data: { lessonId: null },
  })

  // Снимаем placeholder-attendances (разовые ученики, не отмеченные) — у них
  // нет списаний, оставлять их незачем.
  await db.attendance.deleteMany({
    where: { lessonId: id, tenantId, isPending: true },
  })

  // Пакет с выбором: снимок выборов ДО удаления (cascade сотрёт строки), задачи
  // на перевыбор — после (решение владельца №2). Для не-package пусто.
  const { snapshotPackageSelections, createReselectPackageLessonTasks } = await import(
    "@/lib/tasks/reselect-package-lesson"
  )
  const selSnapshot = await snapshotPackageSelections(db, tenantId, [id])

  // Удаление и снимок в архив — одной транзакцией: занятие не должно исчезнуть
  // без записи, по которой его можно вернуть. Архив пишем после delete, чтобы
  // отказ удаления (FK от заметок о ребёнке или отработок) не оставил строку
  // про живое занятие.
  await db.$transaction(async (tx) => {
    await tx.lesson.delete({ where: { id } })
    await archiveDeletedLesson(tx, {
      tenantId,
      lesson,
      packageSelections: selSnapshot,
      deletedBy: employeeId ?? null,
    })
  })

  logAudit({
    tenantId,
    employeeId: employeeId ?? null,
    action: "delete",
    entityType: "Lesson",
    entityId: id,
    changes: {
      date: { old: lesson.date.toISOString().slice(0, 10) },
      startTime: { old: lesson.startTime },
      groupId: { old: lesson.groupId },
    },
    req,
  })

  // Живые календарные абонементы периода теряют одно занятие — уменьшаем
  // totalLessons/сумму (переплата вернётся на баланс родителя через reprice).
  // Отменённое занятие дельту не даёт: отмена не декрементила totalLessons
  // (вариант A), удаление её записи денег не меняет.
  if (lesson.status !== "cancelled") {
    const { recalcSubscriptionsOnScheduleChange } = await import(
      "@/lib/subscriptions/recalc-on-schedule-change"
    )
    await recalcSubscriptionsOnScheduleChange(db, {
      tenantId,
      groupId: lesson.groupId,
      addedDates: [],
      removedDates: [new Date(lesson.date)],
      createdBy: employeeId ?? null,
    })
  }

  await createReselectPackageLessonTasks(db, tenantId, selSnapshot, employeeId ?? null)

  return NextResponse.json({ ok: true })
}
