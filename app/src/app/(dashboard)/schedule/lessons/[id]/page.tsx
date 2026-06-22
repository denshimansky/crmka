import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { rosterWhereOnDate } from "@/lib/subscriptions/roster-filter"
import { notFound } from "next/navigation"
import { isUnscoped } from "@/lib/branch-scope"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Clock, MapPin, User, BookOpen } from "lucide-react"
import { AttendanceTable } from "./attendance-table"
import { DeleteLessonButton } from "./delete-lesson-button"
import { MoveLessonDialog } from "./move-lesson-dialog"
import { PageHelp } from "@/components/page-help"
import { maskPhone } from "@/lib/permissions/phone-visibility"

const LESSON_STATUS_LABELS: Record<string, string> = {
  scheduled: "Запланировано",
  completed: "Проведено",
  cancelled: "Отменено",
}

const LESSON_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  scheduled: "secondary",
  completed: "default",
  cancelled: "destructive",
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " \u20BD"
}

// \u0421\u043A\u0438\u0434\u043A\u0438 v2: \u0441\u0443\u043C\u043C\u0430 \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u044F\u0449\u0435\u0433\u043E \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F = \u044D\u0444\u0444\u0435\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0446\u0435\u043D\u0430 \u0437\u0430\u043D\u044F\u0442\u0438\u044F.
function effPrice(sub: { lessonPrice: unknown; discountPerLesson?: unknown } | null | undefined): number | null {
  if (!sub) return null
  return Math.max(0, Number(sub.lessonPrice) - Number(sub.discountPerLesson ?? 0))
}

export default async function LessonCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  const lesson = await db.lesson.findFirst({
    where: { id, tenantId },
    include: {
      group: {
        include: {
          direction: { select: { id: true, name: true, lessonPrice: true, singleVisitPrice: true } },
          room: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      },
      instructor: { select: { id: true, firstName: true, lastName: true } },
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
      attendances: {
        include: {
          attendanceType: true,
          subscription: { select: { id: true, lessonPrice: true, discountPerLesson: true, balance: true } },
        },
      },
    },
  })

  if (!lesson) notFound()

  // ADM-04: проверка доступа.
  // — Инструктор видит только свои занятия (instructorId=me либо substituteInstructorId=me).
  // — Админ/менеджер с ограниченным scope — только занятия групп в своих филиалах.
  // — Owner и без ограничений — видит всё.
  const scope = await getBranchScope()
  if (session.user.role === "instructor") {
    const isOwn =
      lesson.instructorId === session.user.employeeId ||
      lesson.substituteInstructorId === session.user.employeeId
    if (!isOwn) notFound()
  } else if (!isUnscoped(scope)) {
    if (!scope.branchIds.includes(lesson.group.branchId)) notFound()
  }

  // Кандидаты на замену — только действующие преподаватели (role=instructor,
  // isActive) и только из филиала группы (либо без привязок = кросс-филиально).
  // Владельцы/управляющие/админы и уволенные сотрудники не предлагаются —
  // список «педагогов» совпадает с выбором инструктора при создании группы.
  const lessonBranchId = lesson.group.branchId
  const instructorsRaw = await db.employee.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      role: "instructor",
      OR: [
        { employeeBranches: { none: {} } },
        { employeeBranches: { some: { branchId: lessonBranchId } } },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
  })
  // Если текущий «замещающий» уже стоит, но он не в этом филиале — добавим его, чтобы было видно, кто стоит
  const instructors =
    lesson.substituteInstructor &&
    !instructorsRaw.some((i) => i.id === lesson.substituteInstructor!.id)
      ? [lesson.substituteInstructor, ...instructorsRaw]
      : instructorsRaw

  // Get subscriptions for this period
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
      discountPerLesson: true,
      balance: true,
      startDate: true,
    },
  })

  // Состав занятия. Дата = граница состава: активные (withdrawnAt IS NULL) +
  // отчисленные/переведённые ПОЗЖЕ даты занятия (withdrawnAt > date), чтобы ученик
  // был виден в занятиях по дату отчисления включительно. isActive=false без
  // withdrawnAt не бывает. enrolledAt отсекается ниже в JS (+ фоллбэк по абонементу).
  const enrollmentsRaw = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      deletedAt: null,
      ...rosterWhereOnDate(lesson.date),
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  // Ребёнок попадает в состав занятия, если его абонемент покрывает дату
  // занятия (startDate <= дата) — расписание идёт от абонемента, а не от
  // оплат/посещений. Фоллбэк на enrolledAt оставляем для зачислений без
  // абонемента (например, «ожидание оплаты» без выписанного абонемента).
  // Иначе при переоформлении абонемента задним числом (enrolledAt создаётся
  // позже даты занятия, чем startDate) ребёнок ошибочно считался бы «разовым».
  const coveringSubKeys = new Set(
    subscriptions
      .filter((s) => s.startDate <= lesson.date)
      .map((s) => `${s.clientId}:${s.wardId || ""}`),
  )
  const enrollments = enrollmentsRaw.filter(
    (e) =>
      e.enrolledAt <= lesson.date ||
      coveringSubKeys.has(`${e.clientId}:${e.wardId || ""}`),
  )

  // Get attendance types
  const attendanceTypes = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  })

  // Get absence reasons
  const absenceReasons = await db.absenceReason.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  })

  // Get salary rate — use substitute instructor rate if present
  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: effectiveInstructorId,
      directionId: lesson.group.directionId,
    },
  })

  // Build makeup students (isMakeup attendances — students not enrolled in this group)
  const enrolledClientKeys = new Set(
    enrollments.map(e => `${e.clientId}:${e.wardId || ""}`)
  )
  const makeupAttendances = lesson.attendances.filter(a => a.isMakeup)

  // Fetch client info for makeup students
  const makeupClientIds = [...new Set(makeupAttendances.map(a => a.clientId))]
  const makeupClients = makeupClientIds.length > 0
    ? await db.client.findMany({
        where: { id: { in: makeupClientIds }, tenantId },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
    : []
  const makeupWardIds = makeupAttendances.map(a => a.wardId).filter(Boolean) as string[]
  const makeupWards = makeupWardIds.length > 0
    ? await db.ward.findMany({
        where: { id: { in: makeupWardIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []

  // Для уже отмеченных отработок — детали исходного занятия (на L1).
  const makeupSourceIds = [
    ...new Set(
      makeupAttendances
        .map((a) => a.makeupOfLessonId)
        .filter((x): x is string => !!x),
    ),
  ]
  const makeupSourceLessons = makeupSourceIds.length
    ? await db.lesson.findMany({
        where: { id: { in: makeupSourceIds }, tenantId },
        select: {
          id: true,
          date: true,
          startTime: true,
          group: {
            select: {
              name: true,
              direction: { select: { name: true } },
            },
          },
        },
      })
    : []

  // Ф7: «Виртуальные» отработки — те, у кого admin поставил «Назначена отработка»
  // с scheduledMakeupLessonId=текущему lessonId, но реальная отметка на L2 ещё
  // не сделана. Показываем такого ребёнка строкой с бейджем «Отработка за DD.MM».
  const expectedArrivals = await db.attendance.findMany({
    where: {
      tenantId,
      scheduledMakeupLessonId: id,
      attendanceType: { code: "makeup_scheduled" },
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      subscription: { select: { id: true, lessonPrice: true, discountPerLesson: true } },
      lesson: {
        select: {
          id: true,
          date: true,
          startTime: true,
          group: {
            select: {
              name: true,
              direction: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  // Ward подгружаем отдельным запросом — у Attendance нет relation на Ward.
  const expectedArrivalWardIds = expectedArrivals
    .map((a) => a.wardId)
    .filter((x): x is string => !!x)
  const expectedArrivalWards = expectedArrivalWardIds.length
    ? await db.ward.findMany({
        where: { id: { in: expectedArrivalWardIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  // Уже отмеченные отработки — исключаем из виртуальных (показываем как marked).
  const markedMakeupKeys = new Set(
    makeupAttendances.map((a) => `${a.clientId}:${a.wardId || ""}`),
  )
  const virtualArrivals = expectedArrivals.filter(
    (a) => !markedMakeupKeys.has(`${a.clientId}:${a.wardId || ""}`),
  )

  // Пробные ученики на этом занятии
  const trialLessons = await db.trialLesson.findMany({
    where: {
      tenantId,
      lessonId: id,
      status: { in: ["scheduled", "attended", "no_show"] },
    },
    select: {
      id: true,
      status: true,
      clientId: true,
      wardId: true,
      instructorPayEnabled: true,
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  // Соответствующие записи Attendance (для уже отмеченных пробных) —
  // оттуда берём фактическую сумму ЗП инструктора.
  const trialClientKeys = trialLessons.map((t) => ({
    clientId: t.clientId,
    wardId: t.wardId,
  }))
  const trialAttendances = trialClientKeys.length
    ? await db.attendance.findMany({
        where: {
          tenantId,
          lessonId: id,
          isTrial: true,
          OR: trialClientKeys.map((k) => ({
            clientId: k.clientId,
            wardId: k.wardId,
          })),
        },
        select: {
          clientId: true,
          wardId: true,
          instructorPayAmount: true,
          instructorPayEnabled: true,
        },
      })
    : []

  // Отработки этого занятия в других группах: ученики, у которых пропуск этого
  // Lesson уже компенсирован Attendance с makeupOfLessonId=lesson.id.
  // Используется, чтобы UI пометил их «Отработано в …» и не списал ещё раз.
  // chargeAmount > 0 — отрезаем «не пришёл на отработку» (Не был у виртуальной
  // строки L2 сохраняет isMakeup=true + makeupOfLessonId, но chargeAmount=0).
  // Без этого фильтра бейдж «отработано DD.MM» оставался бы и после смены Был→Не был.
  const madeUpAttendances = await db.attendance.findMany({
    where: { tenantId, makeupOfLessonId: lesson.id, chargeAmount: { gt: 0 } },
    select: {
      id: true,
      wardId: true,
      clientId: true,
      lesson: {
        select: {
          id: true,
          date: true,
          startTime: true,
          group: {
            select: {
              name: true,
              direction: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  // Целевые занятия для «Назначена отработка»: ученики этого Lesson, у которых
  // scheduledMakeupLessonId указывает на будущее занятие. Подгружаем детали
  // для плашки «назначена отработка ДД.ММ».
  const scheduledMakeupIds = [
    ...new Set(
      lesson.attendances
        .map((a) => a.scheduledMakeupLessonId)
        .filter((x): x is string => !!x),
    ),
  ]
  const scheduledMakeupLessons = scheduledMakeupIds.length
    ? await db.lesson.findMany({
        where: { id: { in: scheduledMakeupIds }, tenantId },
        select: {
          id: true,
          date: true,
          startTime: true,
          group: {
            select: {
              name: true,
              direction: { select: { name: true } },
            },
          },
        },
      })
    : []

  const currentRole = session.user.role

  const trialStudents = trialLessons.map((t) => {
    const att = trialAttendances.find(
      (a) => a.clientId === t.clientId && a.wardId === t.wardId
    )
    return {
      trialId: t.id,
      clientId: t.clientId,
      clientName: [t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Без имени",
      clientPhone: maskPhone(t.client.phone, currentRole),
      wardId: t.wardId,
      wardName: t.ward
        ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ")
        : null,
      status: t.status as "scheduled" | "attended" | "no_show",
      instructorPayEnabled: t.instructorPayEnabled,
      instructorPayAmount: att ? Number(att.instructorPayAmount) : 0,
    }
  })

  const makeupStudents = [
    // Уже отмеченные отработки (реальная Attendance на L2 с isMakeup=true).
    ...makeupAttendances.map((a) => {
      const client = makeupClients.find((c) => c.id === a.clientId)
      const ward = a.wardId ? makeupWards.find((w) => w.id === a.wardId) : null
      const sourceLesson = a.makeupOfLessonId
        ? makeupSourceLessons.find((l) => l.id === a.makeupOfLessonId)
        : null
      return {
        enrollmentId: `makeup-${a.id}`,
        clientId: a.clientId,
        clientName: client
          ? [client.lastName, client.firstName].filter(Boolean).join(" ") || "Без имени"
          : "Без имени",
        clientPhone: maskPhone(client?.phone || null, currentRole),
        wardId: a.wardId,
        wardName: ward ? [ward.lastName, ward.firstName].filter(Boolean).join(" ") : null,
        subscriptionId: a.subscriptionId,
        lessonPrice: effPrice(a.subscription) ?? 0,
        isMakeup: true as const,
        makeupSource: sourceLesson
          ? {
              lessonId: sourceLesson.id,
              date: sourceLesson.date.toISOString().slice(0, 10),
              startTime: sourceLesson.startTime,
              directionName: sourceLesson.group.direction.name,
              groupName: sourceLesson.group.name,
            }
          : null,
        attendance: {
          id: a.id,
          attendanceTypeId: a.attendanceTypeId,
          attendanceTypeName: a.attendanceType.name,
          attendanceTypeCode: a.attendanceType.code,
          chargeAmount: Number(a.chargeAmount),
          instructorPayAmount: Number(a.instructorPayAmount),
          instructorPayEnabled: a.instructorPayEnabled,
          absenceReasonId: a.absenceReasonId,
        },
      }
    }),
    // Ф7: «Виртуальные» отработки — ожидают отметки. На L2 пока нет Attendance,
    // она появится при первом «Был» / «Не был». attendance=null → строка показана
    // как «Не отмечен» с бейджем «Отработка за DD.MM».
    ...virtualArrivals.map((a) => {
      const w = a.wardId ? expectedArrivalWards.find((x) => x.id === a.wardId) : null
      return {
        enrollmentId: `virtual-makeup-${a.id}`,
        clientId: a.clientId,
        clientName:
          [a.client.lastName, a.client.firstName].filter(Boolean).join(" ") || "Без имени",
        clientPhone: maskPhone(a.client.phone, currentRole),
        wardId: a.wardId,
        wardName: w ? [w.lastName, w.firstName].filter(Boolean).join(" ") : null,
        subscriptionId: a.subscriptionId,
        lessonPrice: effPrice(a.subscription) ?? 0,
        isMakeup: true as const,
        makeupSource: {
          lessonId: a.lesson.id,
          date: a.lesson.date.toISOString().slice(0, 10),
          startTime: a.lesson.startTime,
          directionName: a.lesson.group.direction.name,
          groupName: a.lesson.group.name,
        },
        attendance: null,
      }
    }),
  ]

  // Разовые ученики — Attendance без активного GroupEnrollment, не trial и
  // не makeup. Включают и placeholder (isPending=true, «Не отмечен»), и реально
  // отмеченные разовые посещения.
  const enrollmentKeys = new Set(
    enrollments.map((e) => `${e.clientId}:${e.wardId || ""}`),
  )
  const oneTimeAttendances = lesson.attendances.filter((a) => {
    if (a.isMakeup || a.isTrial) return false
    return !enrollmentKeys.has(`${a.clientId}:${a.wardId || ""}`)
  })
  const oneTimeClientIds = [...new Set(oneTimeAttendances.map((a) => a.clientId))]
  const oneTimeClients = oneTimeClientIds.length
    ? await db.client.findMany({
        where: { id: { in: oneTimeClientIds }, tenantId },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
    : []
  const oneTimeWardIds = oneTimeAttendances
    .map((a) => a.wardId)
    .filter((x): x is string => !!x)
  const oneTimeWards = oneTimeWardIds.length
    ? await db.ward.findMany({
        where: { id: { in: oneTimeWardIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []

  // Build serialized data for client component
  const students = enrollments.map((enrollment) => {
    const subscription = subscriptions.find(
      (s) => s.clientId === enrollment.clientId && (
        enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
      )
    )

    // На одного ребёнка на занятии может быть несколько строк Attendance
    // (ключ уникальности — subscription_id): например, осталась отметка от
    // отозванного абонемента + новая на действующем. Предпочитаем строку по
    // активному абонементу ученика, иначе — первую найденную.
    const studentAttendances = lesson.attendances.filter(
      (a) => a.clientId === enrollment.clientId && (
        enrollment.wardId ? a.wardId === enrollment.wardId : !a.wardId
      )
    )
    const attendance =
      (subscription &&
        studentAttendances.find((a) => a.subscriptionId === subscription.id)) ||
      studentAttendances[0]

    const lessonPrice =
      effPrice(subscription) ?? Number(lesson.group.direction.lessonPrice)

    const madeUp = madeUpAttendances.find(
      (m) =>
        m.clientId === enrollment.clientId &&
        (enrollment.wardId ? m.wardId === enrollment.wardId : !m.wardId),
    )

    const scheduledLesson =
      attendance?.scheduledMakeupLessonId
        ? scheduledMakeupLessons.find((l) => l.id === attendance.scheduledMakeupLessonId)
        : null

    return {
      enrollmentId: enrollment.id,
      clientId: enrollment.clientId,
      clientName: [enrollment.client.lastName, enrollment.client.firstName].filter(Boolean).join(" ") || "Без имени",
      clientPhone: maskPhone(enrollment.client.phone, currentRole),
      wardId: enrollment.wardId,
      wardName: enrollment.ward
        ? [enrollment.ward.lastName, enrollment.ward.firstName].filter(Boolean).join(" ")
        : null,
      subscriptionId: subscription?.id || null,
      lessonPrice,
      awaitingPayment: enrollment.paymentStatus === "awaiting_payment",
      makeupResolved: madeUp
        ? {
            attendanceId: madeUp.id,
            lessonId: madeUp.lesson.id,
            date: madeUp.lesson.date.toISOString().slice(0, 10),
            startTime: madeUp.lesson.startTime,
            directionName: madeUp.lesson.group.direction.name,
            groupName: madeUp.lesson.group.name,
          }
        : null,
      scheduledMakeup: scheduledLesson
        ? {
            lessonId: scheduledLesson.id,
            date: scheduledLesson.date.toISOString().slice(0, 10),
            startTime: scheduledLesson.startTime,
            directionName: scheduledLesson.group.direction.name,
            groupName: scheduledLesson.group.name,
          }
        : null,
      attendance: attendance
        ? {
            id: attendance.id,
            attendanceTypeId: attendance.attendanceTypeId,
            attendanceTypeName: attendance.attendanceType.name,
            attendanceTypeCode: attendance.attendanceType.code,
            chargeAmount: Number(attendance.chargeAmount),
            instructorPayAmount: Number(attendance.instructorPayAmount),
            instructorPayEnabled: attendance.instructorPayEnabled,
            absenceReasonId: attendance.absenceReasonId,
            scheduledMakeupLessonId: attendance.scheduledMakeupLessonId,
          }
        : null,
    }
  })

  const oneTimeStudents = oneTimeAttendances.map((a) => {
    const client = oneTimeClients.find((c) => c.id === a.clientId)
    const ward = a.wardId ? oneTimeWards.find((w) => w.id === a.wardId) : null
    const lessonPrice =
      effPrice(a.subscription) ??
      Number(
        lesson.group.direction.singleVisitPrice ?? lesson.group.direction.lessonPrice,
      )
    return {
      enrollmentId: `onetime-${a.id}`,
      clientId: a.clientId,
      clientName: client
        ? [client.lastName, client.firstName].filter(Boolean).join(" ") || "Без имени"
        : "Без имени",
      clientPhone: maskPhone(client?.phone || null, currentRole),
      wardId: a.wardId,
      wardName: ward
        ? [ward.lastName, ward.firstName].filter(Boolean).join(" ")
        : null,
      subscriptionId: a.subscriptionId,
      lessonPrice,
      isOneTime: true as const,
      // Placeholder (isPending=true) рендерим как «Не отмечен» — attendance=null.
      attendance: a.isPending
        ? null
        : {
            id: a.id,
            attendanceTypeId: a.attendanceTypeId,
            attendanceTypeName: a.attendanceType.name,
            attendanceTypeCode: a.attendanceType.code,
            chargeAmount: Number(a.chargeAmount),
            instructorPayAmount: Number(a.instructorPayAmount),
            instructorPayEnabled: a.instructorPayEnabled,
            absenceReasonId: a.absenceReasonId,
            scheduledMakeupLessonId: a.scheduledMakeupLessonId,
          },
    }
  })

  const allStudents = [...students, ...oneTimeStudents]

  const attendanceTypesData = attendanceTypes.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    chargesSubscription: t.chargesSubscription,
    paysInstructor: t.paysInstructor,
    availableToInstructor: t.availableToInstructor,
    availableToAdmin: t.availableToAdmin,
  }))

  const currentUserRole = currentRole

  const salaryRateData = salaryRate
    ? {
        scheme: salaryRate.scheme,
        ratePerStudent: salaryRate.ratePerStudent ? Number(salaryRate.ratePerStudent) : null,
        ratePerLesson: salaryRate.ratePerLesson ? Number(salaryRate.ratePerLesson) : null,
        fixedPerShift: salaryRate.fixedPerShift ? Number(salaryRate.fixedPerShift) : null,
      }
    : null

  const instructorName = [lesson.instructor.lastName, lesson.instructor.firstName].filter(Boolean).join(" ")
  const substituteInstructorName = lesson.substituteInstructor
    ? [lesson.substituteInstructor.lastName, lesson.substituteInstructor.firstName].filter(Boolean).join(" ")
    : null

  const instructorsData = instructors
    .filter((i) => i.id !== lesson.instructorId)
    .map((i) => ({
      id: i.id,
      name: [i.lastName, i.firstName].filter(Boolean).join(" "),
    }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/schedule">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{lesson.group.name}</h1>
            <PageHelp pageKey="schedule/lessons/[id]" />
            <Badge variant={LESSON_STATUS_VARIANT[lesson.status] || "secondary"}>
              {LESSON_STATUS_LABELS[lesson.status] || lesson.status}
            </Badge>
            {lesson.isTrial && <Badge variant="outline">Пробное</Badge>}
            {lesson.isMakeup && <Badge variant="outline">Отработка</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {lesson.group.direction.name}
          </p>
        </div>
        {(session.user.role === "owner" ||
          session.user.role === "manager" ||
          session.user.role === "admin") && (
          <div className="flex items-center gap-2">
            <MoveLessonDialog
              lessonId={id}
              currentDateISO={lesson.date.toISOString().slice(0, 10)}
              currentStartTime={lesson.startTime}
              currentDurationMinutes={lesson.durationMinutes}
              attendancesCount={lesson.attendances.length}
              canMove={
                lesson.attendances.length > 0
                  ? session.user.role === "owner" || session.user.role === "manager"
                  : true
              }
            />
            <DeleteLessonButton lessonId={id} />
          </div>
        )}
      </div>

      {/* Lesson info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Дата и время</div>
              <div className="text-sm font-medium">
                {formatDate(lessonDate)}
              </div>
              <div className="text-sm">
                {lesson.startTime} ({lesson.durationMinutes} мин)
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MapPin className="size-5 text-muted-foreground" />
            <div>
              {lesson.group.branch && (
                <div className="text-sm font-medium">{lesson.group.branch.name}</div>
              )}
              <div className="text-xs text-muted-foreground">Кабинет</div>
              <div className="text-sm font-medium">{lesson.group.room.name}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <User className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Педагог</div>
              <div className="text-sm font-medium">{instructorName}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BookOpen className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Учеников</div>
              <div className="text-sm font-medium">{allStudents.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attendance table (client component) */}
      <AttendanceTable
        lessonId={id}
        lessonDateISO={lesson.date.toISOString().slice(0, 10)}
        groupId={lesson.groupId}
        topic={lesson.topic}
        homework={lesson.homework}
        students={allStudents}
        makeupStudents={makeupStudents}
        trialStudents={trialStudents}
        attendanceTypes={attendanceTypesData}
        salaryRate={salaryRateData}
        absenceReasons={absenceReasons}
        instructorName={instructorName}
        substituteInstructorId={lesson.substituteInstructorId}
        substituteInstructorName={substituteInstructorName}
        instructors={instructorsData}
        currentUserRole={currentUserRole}
        groupIsOneTime={lesson.group.isOneTime}
      />
    </div>
  )
}
