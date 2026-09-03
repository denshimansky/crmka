import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { formatWardName } from "@/lib/format-name"
import { currencySymbol } from "@/lib/currency"
import { communicationAuthorLabel } from "@/lib/communications/author-label"
import {
  CLIENT_STATUS_CHANGE_REASON_LABELS,
  type ClientStatusChangeReason,
} from "@/lib/clients/status-history"
import {
  subscriptionPeriodLabel,
  type SubscriptionPeriodInput,
} from "@/lib/subscriptions/period-label"

// Точные типы результатов findMany c include — нужны, чтобы в ward-режиме
// (когда мы возвращаем пустой массив вместо запроса) типизация сохранилась.
type TimelineCommunication = Prisma.CommunicationGetPayload<{
  include: { employee: { select: { firstName: true; lastName: true } } }
}>
type TimelinePayment = Prisma.PaymentGetPayload<{
  include: {
    account: { select: { name: true } }
    subscription: {
      select: {
        periodYear: true
        periodMonth: true
        direction: { select: { name: true } }
        group: { select: { name: true } }
        ward: { select: { firstName: true; lastName: true } }
      }
    }
  }
}>
type TimelineAuditLog = Prisma.AuditLogGetPayload<{
  include: { employee: { select: { firstName: true; lastName: true } } }
}>
type TimelineApplication = Prisma.ApplicationGetPayload<{
  include: {
    direction: { select: { name: true } }
    ward: { select: { firstName: true; lastName: true } }
    processor: { select: { firstName: true; lastName: true } }
  }
}>
type TimelineBalanceTxn = Prisma.ClientBalanceTransactionGetPayload<{
  include: {
    subscription: {
      select: {
        periodYear: true
        periodMonth: true
        direction: { select: { name: true } }
        ward: { select: { firstName: true; lastName: true } }
      }
    }
    direction: { select: { name: true } }
    lesson: { select: { date: true; startTime: true } }
    attendance: { select: { wardId: true } }
  }
}>

/**
 * Период абонемента для ленты: «MM.YYYY» (календарный) или «дата – дата» (пакет,
 * старт – окончание). null, если данных нет. Для пакета нужны type/startDate/
 * expiresAt (в подзапросах с урезанным select они отсутствуют → период не покажем).
 */
function periodLabel(s: SubscriptionPeriodInput): string | null {
  return subscriptionPeriodLabel(s, "numeric")
}

/**
 * GET /api/clients/[id]/timeline
 * Сводная лента событий клиента: коммуникации + пробники + абонементы (создание/закрытие)
 * + оплаты + посещения + смены статуса в одной отсортированной timeline.
 *
 * Возвращает массив TimelineEvent отсортированный по дате (desc).
 */

type EventKind =
  | "communication"
  | "trial_scheduled"
  | "trial_attended"
  | "trial_no_show"
  | "subscription_created"
  | "subscription_recalculated"
  | "subscription_closed"
  | "payment_in"
  | "payment_refund"
  | "subscription_paid_from_balance"
  | "balance_credit"
  | "balance_debit"
  | "lesson_note"
  | "attendance_present"
  | "attendance_absent"
  | "attendance_other"
  | "status_change"
  | "template_discount_removed"
  | "discount_mode_changed"
  | "application_created"
  | "application_stage"
  | "application_processed"
  | "application_removed"

export interface TimelineEvent {
  id: string
  kind: EventKind
  date: string
  title: string
  description?: string | null
  meta?: Record<string, unknown>
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: clientId } = await params
  const tenantId = (session.user as any).tenantId

  // Валюта организации — для символа в строках таймлайна (формат числа не меняем).
  const currency =
    (
      await db.organization.findUnique({
        where: { id: tenantId },
        select: { currency: true },
      })
    )?.currency ?? "RUB"
  const sym = currencySymbol(currency)

  // wardId — опциональный фильтр: ограничивает ленту событиями только этого
  // ребёнка (используется на карточке /crm/wards/[id]). Коммуникации, оплаты
  // и смены статуса клиента — общие на семью, поэтому в ward-режиме их не
  // показываем.
  const wardId = new URL(req.url).searchParams.get("wardId") || null

  // Проверяем что клиент принадлежит организации
  const client = await db.client.findFirst({
    where: { id: clientId, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client)
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Если указан wardId — проверяем принадлежность ребёнка клиенту/тенанту
  if (wardId) {
    const ward = await db.ward.findFirst({
      where: { id: wardId, clientId, tenantId },
      select: { id: true },
    })
    if (!ward) {
      return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })
    }
  }

  // Параллельно собираем всё, что относится к клиенту (или ребёнку, если wardId).
  // В ward-режиме коммуникации/оплаты/аудит-статусы клиента — не подгружаем.
  const [
    communications,
    trials,
    subscriptions,
    payments,
    attendances,
    auditLogs,
    balanceTxns,
    applications,
  ] = await Promise.all([
    wardId
      ? Promise.resolve([] as TimelineCommunication[])
      : db.communication.findMany({
          where: { tenantId, clientId },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
          // По времени события: сообщения из расширения заливаются задним
          // числом (см. communications/route.ts и миграцию 20260828150000).
          orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          take: 200,
        }),
    db.trialLesson.findMany({
      where: { tenantId, clientId, ...(wardId ? { wardId } : {}) },
      include: {
        direction: { select: { name: true } },
        instructor: { select: { firstName: true, lastName: true } },
        ward: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.subscription.findMany({
      where: { tenantId, clientId, deletedAt: null, ...(wardId ? { wardId } : {}) },
      include: {
        direction: { select: { name: true } },
        group: { select: { name: true } },
        ward: { select: { firstName: true, lastName: true } },
        withdrawalReason: { select: { name: true } },
        // Имя ручного шаблона (скидка тип 2 / v3) — для строки скидки в истории.
        discountTemplate: { select: { name: true, valueType: true, value: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    wardId
      ? Promise.resolve([] as TimelinePayment[])
      : db.payment.findMany({
          where: { tenantId, clientId, deletedAt: null },
          include: {
            account: { select: { name: true } },
            subscription: {
              select: {
                periodYear: true,
                periodMonth: true,
                direction: { select: { name: true } },
                group: { select: { name: true } },
                ward: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { date: "desc" },
          take: 200,
        }),
    db.attendance.findMany({
      where: { tenantId, clientId, ...(wardId ? { wardId } : {}) },
      include: {
        attendanceType: { select: { name: true, code: true } },
        absenceReason: { select: { name: true } },
        lesson: {
          select: {
            date: true,
            startTime: true,
            group: { select: { name: true, direction: { select: { name: true } } } },
          },
        },
      },
      orderBy: { markedAt: "desc" },
      take: 500,
    }),
    wardId
      ? Promise.resolve([] as TimelineAuditLog[])
      : db.auditLog.findMany({
          where: {
            tenantId,
            entityType: "Client",
            entityId: clientId,
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
    wardId
      ? Promise.resolve([] as TimelineBalanceTxn[])
      : db.clientBalanceTransaction.findMany({
          where: { tenantId, clientId },
          include: {
            subscription: {
              select: {
                periodYear: true,
                periodMonth: true,
                direction: { select: { name: true } },
                ward: { select: { firstName: true, lastName: true } },
              },
            },
            direction: { select: { name: true } },
            lesson: { select: { date: true, startTime: true } },
            attendance: { select: { wardId: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
    // Заявки воронки «Продажи» — включая soft-deleted (удаление из воронки —
    // тоже событие истории), поэтому deletedAt не фильтруем.
    db.application.findMany({
      where: { tenantId, clientId, ...(wardId ? { wardId } : {}) },
      include: {
        direction: { select: { name: true } },
        ward: { select: { firstName: true, lastName: true } },
        processor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }) as Promise<TimelineApplication[]>,
  ])

  // Аудит заявок: ручные переходы этапа (changes.stage = {old,new}) пишутся
  // с entityType="Application" — тянем отдельным запросом по id заявок клиента.
  const appAuditLogs = applications.length > 0
    ? await db.auditLog.findMany({
        where: {
          tenantId,
          entityType: "Application",
          entityId: { in: applications.map((a) => a.id) },
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        take: 300,
      })
    : []

  // Аудит абонементов: выписка (action=create, сумма выписки) и пересчёты цены
  // (action=update, было → стало). Пишутся в lib/subscriptions/audit-price.ts.
  // Тянем отдельным запросом по id абонементов клиента — как аудит заявок выше.
  const subAuditLogs = subscriptions.length > 0
    ? await db.auditLog.findMany({
        where: {
          tenantId,
          entityType: "Subscription",
          entityId: { in: subscriptions.map((s) => s.id) },
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    : []

  // Сумма выписки: у абонементов, выписанных до появления этого аудита, записи
  // нет — там остаётся живой finalAmount (как было раньше).
  const issuedAmountBySub = new Map<string, string>()
  for (const log of subAuditLogs) {
    if (log.action !== "create") continue
    const c = (log.changes as Record<string, any> | null)?.finalAmount
    if (c && c.new != null) issuedAmountBySub.set(log.entityId, String(c.new))
  }

  // Имена детей для посещений и операций баланса: Attendance.wardId — голая
  // колонка без Prisma-relation, поэтому подтягиваем батчем.
  const wardIds = new Set<string>()
  for (const a of attendances) if (a.wardId) wardIds.add(a.wardId)
  for (const t of balanceTxns) if (t.attendance?.wardId) wardIds.add(t.attendance.wardId)
  const wardNameById = new Map<string, string>()
  if (wardIds.size > 0) {
    const wards = await db.ward.findMany({
      where: { id: { in: Array.from(wardIds) }, tenantId },
      select: { id: true, firstName: true, lastName: true },
    })
    for (const w of wards) {
      const n = formatWardName(w, "")
      if (n) wardNameById.set(w.id, n)
    }
  }

  // Автор события (кто внёс — баг #117) для сущностей, где сотрудник хранится
  // «голой» колонкой createdBy/markedBy без Prisma-relation (Payment, Attendance,
  // TrialLesson, Application, ClientBalanceTransaction). Собираем все id и
  // подтягиваем имена одним запросом, дальше проставляем в meta.author событий.
  const authorIds = new Set<string>()
  for (const p of payments) if (p.createdBy) authorIds.add(p.createdBy)
  for (const a of attendances) if (a.markedBy) authorIds.add(a.markedBy)
  for (const t of trials) if (t.createdBy) authorIds.add(t.createdBy)
  for (const a of applications) if (a.createdBy) authorIds.add(a.createdBy)
  for (const t of balanceTxns) if (t.createdBy) authorIds.add(t.createdBy)
  const authorNameById = new Map<string, string>()
  if (authorIds.size > 0) {
    const emps = await db.employee.findMany({
      where: { id: { in: Array.from(authorIds) }, tenantId },
      select: { id: true, firstName: true, lastName: true },
    })
    for (const e of emps) {
      const n = [e.lastName, e.firstName].filter(Boolean).join(" ").trim()
      if (n) authorNameById.set(e.id, n)
    }
  }
  const authorName = (empId: string | null | undefined): string | null =>
    empId ? authorNameById.get(empId) ?? null : null

  // Свободные комментарии оператора к занятиям (lesson_student_notes) — вводятся в
  // реестре «Пропуски» и встраиваются в событие «посещение» истории. Ключ —
  // (занятие, подопечный) для этого клиента (wardId || "" — как и прочие ключи).
  // Берём ВСЕ заметки клиента, а не только по занятиям с отметками: заметка
  // пишется и на «Неотмеченных», и переживает удаление занятия (lessonId
  // обнуляется, опорой остаётся lessonDate). Те, что легли на отметку, —
  // встраиваем в её событие; остальные идут отдельными событиями ленты, иначе
  // комментарий оператора нигде в истории клиента не виден.
  const attLessonIds = new Set(attendances.map((a) => a.lessonId))
  const lessonNotes = await db.lessonStudentNote.findMany({
    where: { tenantId, clientId },
    select: {
      id: true,
      lessonId: true,
      lessonDate: true,
      wardId: true,
      comment: true,
      createdAt: true,
      createdBy: true,
      lesson: {
        select: {
          date: true,
          startTime: true,
          group: { select: { name: true, direction: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })
  const lessonNoteMap = new Map<string, string>()
  for (const n of lessonNotes) {
    if (n.lessonId) lessonNoteMap.set(`${n.lessonId}|${n.wardId || ""}`, n.comment)
  }

  const events: TimelineEvent[] = []

  // --- Коммуникации
  const COMM_TITLES: Record<string, string> = {
    note: "Заметка",
    call_incoming: "Входящий звонок",
    call_outgoing: "Исходящий звонок",
    whatsapp_incoming: "WhatsApp (входящее)",
    whatsapp_outgoing: "WhatsApp (исходящее)",
    sms_outgoing: "SMS",
    email_outgoing: "Email",
    task_result: "Результат задачи",
    call_campaign_result: "Результат обзвона",
  }
  // Сообщения из браузерного расширения: тип общий на все мессенджеры, сам
  // мессенджер несёт channel (docs/messenger-extension.md).
  const CHANNEL_TITLES: Record<string, string> = {
    whatsapp: "WhatsApp",
    telegram: "Телеграм",
    vk: "ВКонтакте",
    max: "MAX",
  }
  const commTitle = (type: string, channel: string, direction: string): string => {
    if (type === "messenger_incoming" || type === "messenger_outgoing") {
      const channelName = CHANNEL_TITLES[channel] ?? "Сообщение"
      return `${channelName} (${direction === "incoming" ? "входящее" : "исходящее"})`
    }
    return COMM_TITLES[type] || type
  }
  for (const c of communications) {
    // Строки из расширения подписаны рабочим местом («ПК Филиал 1»), прочие —
    // сотрудником. Единая точка: lib/communications/author-label.ts.
    const empName = communicationAuthorLabel(c.metadata, c.employee)
    events.push({
      id: `comm-${c.id}`,
      kind: "communication",
      date: (c.sentAt ?? c.createdAt).toISOString(),
      title: commTitle(c.type, c.channel, c.direction),
      description: c.content || null,
      meta: { author: empName, channel: c.channel },
    })
  }

  // --- Пробные занятия
  for (const t of trials) {
    const wardName = t.ward ? formatWardName(t.ward, "") || null : null
    const directionName = t.direction?.name || ""
    const instructorName = t.instructor
      ? [t.instructor.lastName, t.instructor.firstName].filter(Boolean).join(" ")
      : null

    // событие «записан на пробное» — по дате создания
    events.push({
      id: `trial-created-${t.id}`,
      kind: "trial_scheduled",
      date: t.createdAt.toISOString(),
      title: "Запись на пробное",
      description: [
        directionName,
        wardName ? `подопечный: ${wardName}` : null,
        `на ${t.scheduledDate.toLocaleDateString("ru-RU")}`,
        instructorName ? `инструктор: ${instructorName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { trialId: t.id, author: authorName(t.createdBy) },
    })

    // событие итога: пришёл / не пришёл / отменено
    const trialOutcomeDescription = [
      directionName,
      wardName ? `подопечный: ${wardName}` : null,
      instructorName ? `инструктор: ${instructorName}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    if (t.status === "attended" && t.attendedAt) {
      events.push({
        id: `trial-attended-${t.id}`,
        kind: "trial_attended",
        date: t.attendedAt.toISOString(),
        title: "Пробное посещено",
        description: trialOutcomeDescription,
        meta: { author: authorName(t.createdBy) },
      })
    } else if (t.status === "no_show") {
      events.push({
        id: `trial-noshow-${t.id}`,
        kind: "trial_no_show",
        date: t.scheduledDate.toISOString(),
        title: "Не пришёл на пробное",
        description: trialOutcomeDescription,
        meta: { author: authorName(t.createdBy) },
      })
    }
  }

  // --- Абонементы (создание + закрытие)
  for (const s of subscriptions) {
    const wardName = s.ward ? formatWardName(s.ward, "") || null : null
    const directionName = s.direction?.name || ""
    const amount = Number(s.finalAmount)
    const period = periodLabel(s)
    // Общий «паспорт» абонемента — чтобы из любого события было понятно,
    // о каком именно абонементе речь (на семью их может быть много).
    // Паспорт без суммы — сумма у каждого события своя: «создан» показывает, на
    // что выписывали, «закрыт» — актуальную цену.
    const subPassport = [
      directionName,
      wardName ? `подопечный: ${wardName}` : null,
      s.group ? `группа: ${s.group.name}` : null,
      period ? `период: ${period}` : null,
    ].filter(Boolean)
    const money = (v: number) => `${v.toLocaleString("ru-RU")} ${sym}`
    const subDescription = [...subPassport, `сумма: ${money(amount)}`]
    // Сумма на момент выписки: из аудита, иначе (легаси) — живая.
    const issuedRaw = issuedAmountBySub.get(s.id)
    const issuedAmount = issuedRaw != null ? Number(issuedRaw) : amount

    // Строка о применённой скидке (только для события создания). discountSource
    // однозначно определяет тип: type1 — авто «за второй абонемент», type2 —
    // ручной шаблон (имя в discountTemplate), legacy — архивная логика.
    const discountAmount = Number(s.discountAmount)
    let discountLine: string | null = null
    if (discountAmount > 0 && s.discountSource !== "none") {
      const total = `всего −${discountAmount.toLocaleString("ru-RU")} ${sym}`
      const perLesson = Number(s.discountPerLesson)
      let name: string
      let valuePart: string | null = null
      if (s.discountSource === "type1") {
        name = "Скидка за второй абонемент"
      } else if (s.discountSource === "type2" && s.discountTemplate) {
        name = s.discountTemplate.name
        if (s.discountTemplate.valueType === "percent") {
          valuePart = `${Number(s.discountTemplate.value)}%`
        }
      } else if (s.discountSource === "legacy") {
        name = "скидка (архивная)"
      } else {
        name = "скидка"
      }
      if (!valuePart && perLesson > 0) {
        valuePart = `−${perLesson.toLocaleString("ru-RU")} ${sym}/занятие`
      }
      const inner = [valuePart, total].filter(Boolean).join(", ")
      discountLine = `скидка: ${name} (${inner})`
    }

    events.push({
      id: `sub-created-${s.id}`,
      kind: "subscription_created",
      date: s.createdAt.toISOString(),
      title: "Абонемент создан",
      description: [
        ...subPassport,
        `выписан на: ${money(issuedAmount)}`,
        discountLine,
      ].filter(Boolean).join(" · "),
      meta: { subscriptionId: s.id, amount: issuedAmount },
    })

    // Пересчёты цены этого абонемента: скидка, прощённые занятия, правка состава.
    for (const log of subAuditLogs) {
      if (log.entityId !== s.id || log.action !== "update") continue
      const ch = (log.changes as Record<string, any> | null) || {}
      const fa = ch.finalAmount as { old?: unknown; new?: unknown } | undefined
      if (!fa || fa.old == null || fa.new == null) continue
      const reason = typeof ch.reason?.new === "string" ? ch.reason.new : null
      const refunded = ch.refunded?.new != null ? Number(ch.refunded.new) : 0
      const who = log.employee
        ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
        : "Система"
      events.push({
        id: `audit-${log.id}-sub-repriced`,
        kind: "subscription_recalculated",
        date: log.createdAt.toISOString(),
        title: `Абонемент пересчитан — теперь ${money(Number(fa.new))}`,
        description: [
          ...subPassport,
          `было: ${money(Number(fa.old))}`,
          reason ? `причина: ${reason}` : null,
          refunded > 0 ? `возврат на баланс: ${money(refunded)}` : null,
        ].filter(Boolean).join(" · "),
        meta: {
          subscriptionId: s.id,
          amount: Number(fa.new),
          previousAmount: Number(fa.old),
          author: who,
        },
      })
    }

    if ((s.status === "closed" || s.status === "withdrawn") && s.withdrawalDate) {
      // withdrawalDate — @db.Date (без времени) → читается как 00:00 UTC → 03:00 МСК.
      // Для реального времени события берём updatedAt (момент перехода в closed/withdrawn).
      events.push({
        id: `sub-closed-${s.id}`,
        kind: "subscription_closed",
        date: s.updatedAt.toISOString(),
        title: s.status === "withdrawn" ? "Абонемент отчислен" : "Абонемент закрыт",
        description: [
          ...subDescription,
          s.status === "withdrawn"
            ? `дата отчисления: ${s.withdrawalDate.toLocaleDateString("ru-RU")}`
            : null,
          s.withdrawalReason ? `причина: ${s.withdrawalReason.name}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        meta: { subscriptionId: s.id, status: s.status },
      })
    }
  }

  // --- Заявки воронки «Продажи»: создание, переходы этапов (из аудита), финал
  const APP_STAGE_LABELS: Record<string, string> = {
    application: "Заявка",
    trial_scheduled: "Пробное записано",
    trial_attended: "Прошёл пробное",
    awaiting_payment: "Ожидаем оплату",
  }
  const APP_OUTCOME_TITLES: Record<string, string> = {
    won: "Заявка выиграна — купил",
    lead: "Заявка обработана: вернулся в лиды",
    potential: "Заявка обработана: в потенциальные",
    trial: "Заявка обработана: записан на пробное",
  }
  const appById = new Map(applications.map((a) => [a.id, a]))
  for (const a of applications) {
    const appWardName = a.ward ? formatWardName(a.ward, "") || null : null
    const passport = [
      a.direction?.name || null,
      appWardName ? `подопечный: ${appWardName}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    events.push({
      id: `app-created-${a.id}`,
      kind: "application_created",
      date: a.createdAt.toISOString(),
      title: "Заявка создана",
      description: [passport, a.comment].filter(Boolean).join(" · ") || null,
      meta: { applicationId: a.id, author: authorName(a.createdBy) },
    })
    if (a.processedAt && a.processedToStatus) {
      const processorName = a.processor
        ? [a.processor.lastName, a.processor.firstName].filter(Boolean).join(" ")
        : null
      events.push({
        id: `app-processed-${a.id}`,
        kind: "application_processed",
        date: a.processedAt.toISOString(),
        title: APP_OUTCOME_TITLES[a.processedToStatus] || `Заявка обработана: ${a.processedToStatus}`,
        description: passport || null,
        meta: { applicationId: a.id, author: processorName },
      })
    }
    // Удаление из воронки (remove-from-funnel / DELETE) — soft-delete без
    // processedAt: отдельное событие по deletedAt.
    if (a.deletedAt) {
      events.push({
        id: `app-deleted-${a.id}`,
        kind: "application_removed",
        date: a.deletedAt.toISOString(),
        title: "Заявка удалена из воронки",
        description: passport || null,
        meta: { applicationId: a.id },
      })
    }
  }
  for (const log of appAuditLogs) {
    const changes = (log.changes as Record<string, unknown> | null) || null
    const c = changes?.stage as { old?: unknown; new?: unknown } | undefined
    if (!c || c.old === c.new || typeof c.new !== "string") continue
    // Переход в «Пробное записано» всегда сопровождается созданием пробного —
    // в ленте уже есть событие «Запись на пробное» тем же моментом, не дублируем.
    if (c.new === "trial_scheduled") continue
    const app = appById.get(log.entityId)
    const appWardName = app?.ward ? formatWardName(app.ward, "") || null : null
    const author = log.employee
      ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
      : null
    const label = (v: unknown) => (typeof v === "string" ? APP_STAGE_LABELS[v] || v : "—")
    events.push({
      id: `app-audit-${log.id}`,
      kind: "application_stage",
      date: log.createdAt.toISOString(),
      title: "Этап заявки изменён",
      description: [
        `${label(c.old)} → ${label(c.new)}`,
        app?.direction?.name || null,
        appWardName ? `подопечный: ${appWardName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { applicationId: log.entityId, author },
    })
  }

  // --- Оплаты + возвраты + списания с баланса в счёт абонемента
  const METHOD_LABELS: Record<string, string> = {
    cash: "наличные",
    bank_transfer: "безнал",
    acquiring: "эквайринг",
    online_yukassa: "ЮKassa",
    online_robokassa: "Робокасса",
    sbp_qr: "СБП QR",
  }
  for (const p of payments) {
    const amount = Number(p.amount)
    const isRefund = p.type === "refund"
    const isTransferIn = p.type === "transfer_in"
    // Отрицательный transfer_in — сторно «возврат по скидке» (Скидки v2);
    // в ленте его уже показывает ledger-событие discount_refund, пропускаем.
    if (isTransferIn && amount < 0) continue
    // К какому абонементу относится платёж: для transfer_in это главная
    // информация (кассу не показываем — деньги по кассам не двигаются),
    // для оплат/возвратов с привязкой — уточнение.
    const subPeriod = periodLabel(p.subscription)
    const subWardName = p.subscription?.ward
      ? formatWardName(p.subscription.ward, "") || null
      : null
    const subLabel = p.subscription
      ? [
          `${p.subscription.direction.name}${subPeriod ? ` (${subPeriod})` : ""}`,
          subWardName ? `подопечный: ${subWardName}` : null,
          p.subscription.group ? `группа: ${p.subscription.group.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null
    const kind: EventKind = isRefund
      ? "payment_refund"
      : isTransferIn
        ? "subscription_paid_from_balance"
        : "payment_in"
    const title = isRefund
      ? `Возврат ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
      : isTransferIn
        ? `Списание с баланса в счёт абонемента ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
        : `Оплата ${amount.toLocaleString("ru-RU")} ${sym} — пополнение баланса`
    // Payment.date — @db.Date (без времени) → 03:00 МСК. Для таймлайна берём
    // createdAt (момент создания записи в системе) — там полное время.
    events.push({
      id: `pay-${p.id}`,
      kind,
      date: p.createdAt.toISOString(),
      title,
      description: isTransferIn
        ? [subLabel, p.comment].filter(Boolean).join(" · ")
        : [
            METHOD_LABELS[p.method] || p.method,
            p.account?.name,
            subLabel ? (isRefund ? `абонемент: ${subLabel}` : `в счёт: ${subLabel}`) : null,
            p.comment,
          ]
            .filter(Boolean)
            .join(" · "),
      meta: { paymentId: p.id, amount, method: p.method, author: authorName(p.createdBy) },
    })
  }

  // --- Движения баланса, не привязанные к Payment (закрытия с долгом/возвратом,
  // корректировки, разовые посещения, attendance_revert). Записи, дублирующие
  // Payment (payment_received, transfer_to_subscription, refund), пропускаем —
  // они уже есть в блоке выше. Legacy-тип subscription_issued тоже скрываем.
  const LEDGER_SKIP = new Set<string>([
    "payment_received",
    "transfer_to_subscription",
    "refund",
    "subscription_issued",
  ])
  for (const t of balanceTxns) {
    if (LEDGER_SKIP.has(t.type)) continue
    const amount = Number(t.amount)
    const ledgerPeriod = periodLabel(t.subscription)
    // Без абонемента (разовое посещение и т.п.) направление берём из
    // собственной ссылки транзакции.
    const subLabel = t.subscription
      ? `${t.subscription.direction.name}${ledgerPeriod ? ` (${ledgerPeriod})` : ""}`
      : t.direction?.name || null
    const ledgerWardName =
      (t.subscription?.ward ? formatWardName(t.subscription.ward, "") || null : null) ||
      (t.attendance?.wardId ? wardNameById.get(t.attendance.wardId) || null : null)
    const lessonLabel = t.lesson
      ? `занятие ${t.lesson.date.toLocaleDateString("ru-RU")}${t.lesson.startTime ? ` ${t.lesson.startTime}` : ""}`
      : null
    const kind: EventKind = amount >= 0 ? "balance_credit" : "balance_debit"
    const title =
      t.type === "subscription_closed_refund"
        ? amount >= 0
          ? `Закрытие абонемента: +${amount.toLocaleString("ru-RU")} ${sym} на баланс`
          : `Закрытие абонемента: долг ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
        : t.type === "correction"
          ? `Корректировка баланса ${amount >= 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
          : t.type === "personal_lesson_charge"
            ? `Разовое посещение: ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
            : t.type === "trial_charge"
              ? `Пробное занятие: ${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
              : t.type === "lesson_refund"
                ? `Возврат за занятие: +${amount.toLocaleString("ru-RU")} ${sym}`
                : t.type === "discount_refund"
                  ? `Перерасчёт абонемента: +${amount.toLocaleString("ru-RU")} ${sym} на баланс`
                  : t.type === "attendance_revert"
                    ? `Отмена посещения: +${amount.toLocaleString("ru-RU")} ${sym}`
                    : `Операция (${t.type}) ${amount >= 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ru-RU")} ${sym}`
    events.push({
      id: `ledger-${t.id}`,
      kind,
      date: t.createdAt.toISOString(),
      title,
      description: [
        subLabel,
        ledgerWardName ? `подопечный: ${ledgerWardName}` : null,
        lessonLabel,
        t.comment,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { ledgerId: t.id, ledgerType: t.type, amount, author: authorName(t.createdBy) },
    })
  }

  // --- Посещения
  const ATT_CODE_KIND: Record<string, EventKind> = {
    present: "attendance_present",
    absent: "attendance_absent",
  }
  for (const a of attendances) {
    if (!a.markedAt) continue
    const code = a.attendanceType.code
    const lessonDate = a.lesson.date.toLocaleDateString("ru-RU")
    const groupName = a.lesson.group?.name
    const directionName = a.lesson.group?.direction?.name
    // На карточке ребёнка (ward-режим) имя подопечного избыточно.
    const attWardName = !wardId && a.wardId ? wardNameById.get(a.wardId) || null : null
    // Свободный комментарий из реестра «Пропуски» — встраиваем в запись посещения.
    const attNote = lessonNoteMap.get(`${a.lessonId}|${a.wardId || ""}`) ?? null
    events.push({
      id: `att-${a.id}`,
      kind: ATT_CODE_KIND[code] || "attendance_other",
      date: a.markedAt.toISOString(),
      title: `${a.attendanceType.name} · ${lessonDate} ${a.lesson.startTime}`,
      description: [
        directionName,
        groupName ? `группа: ${groupName}` : null,
        attWardName ? `подопечный: ${attWardName}` : null,
        a.absenceReason ? `причина: ${a.absenceReason.name}` : null,
        attNote ? `комментарий: ${attNote}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { attendanceId: a.id, charge: Number(a.chargeAmount), author: authorName(a.markedBy) },
    })
  }

  // --- Комментарии оператора к занятиям, не попавшие в событие посещения
  // (занятие не отмечено или уже удалено — тогда опираемся на снимок даты).
  for (const n of lessonNotes) {
    if (n.lessonId && attLessonIds.has(n.lessonId)) continue
    if (wardId && n.wardId !== wardId) continue
    const when = n.lesson?.date ?? n.lessonDate
    const noteWardName = !wardId && n.wardId ? wardNameById.get(n.wardId) || null : null
    events.push({
      id: `lesson-note-${n.id}`,
      kind: "lesson_note",
      date: n.createdAt.toISOString(),
      title: when
        ? `Комментарий к занятию · ${when.toLocaleDateString("ru-RU")}${n.lesson?.startTime ? ` ${n.lesson.startTime}` : ""}`
        : "Комментарий к занятию",
      description: [
        n.comment,
        n.lesson?.group?.direction?.name ?? null,
        n.lesson?.group?.name ? `группа: ${n.lesson.group.name}` : null,
        noteWardName ? `подопечный: ${noteWardName}` : null,
        n.lessonId ? null : "занятие удалено",
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { author: authorName(n.createdBy) },
    })
  }

  // --- Смены статуса (Client AuditLog) + автоматическое снятие шаблонной скидки
  // Русские подписи для funnelStatus + clientStatus — иначе в ленту просачиваются
  // сырые enum-коды (lead → active_client).
  const STATUS_LABELS: Record<string, string> = {
    new: "Лид",
    trial_scheduled: "Пробное записано",
    trial_attended: "Прошёл пробное",
    awaiting_payment: "Ожидание оплаты",
    active_client: "Активный клиент",
    potential: "Потенциальный",
    non_target: "Не целевой",
    blacklisted: "Чёрный список",
    archived: "Архив",
    active: "Активный",
    churned: "Выбывший",
  }
  for (const log of auditLogs) {
    const changes = (log.changes as Record<string, unknown> | null) || null
    if (!changes) continue

    if (log.action === "template_discount_removed_auto") {
      const subId = (changes.subscriptionId as string) ?? null
      const tplName = (changes.templateName as string) ?? "—"
      const prev = (changes.previousAmount as number) ?? 0
      const wardName = (changes.wardName as string | null) ?? null
      const directionName = (changes.directionName as string) ?? ""
      const who = wardName ? `${wardName} · ` : ""
      events.push({
        id: `audit-${log.id}-discount-removed`,
        kind: "template_discount_removed",
        date: log.createdAt.toISOString(),
        title: `Скидка «${tplName}» снята автоматически`,
        description:
          `${who}${directionName}. Условие шаблона больше не выполняется ` +
          `(было −${prev.toLocaleString("ru-RU")} ${sym}).`,
        meta: { subscriptionId: subId, templateName: tplName, previousAmount: prev },
      })
      continue
    }

    // Смена типа скидки клиента (ручное переключение в карточке): «Авто (за второй)»
    // / «Постоянная скидка: …» / «Без скидки» / «Скидки на абонементы» → с автором.
    if (log.action === "discount_mode_changed") {
      const dm = changes.discountMode as { old?: unknown; new?: unknown } | undefined
      const oldLabel = typeof dm?.old === "string" ? dm.old : "—"
      const newLabel = typeof dm?.new === "string" ? dm.new : "—"
      const who = log.employee
        ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
        : "Система"
      events.push({
        id: `audit-${log.id}-discount-mode`,
        kind: "discount_mode_changed",
        date: log.createdAt.toISOString(),
        title: "Изменён тип скидки",
        description: `${oldLabel} → ${newLabel}`,
        meta: { author: who },
      })
      continue
    }

    // Причина смены (first_payment/paid_lesson/cron_inactive/…) — суффикс к событию.
    const reasonRaw = typeof changes.reason === "string" ? (changes.reason as ClientStatusChangeReason) : null
    const reasonLabel = reasonRaw ? CLIENT_STATUS_CHANGE_REASON_LABELS[reasonRaw] ?? null : null
    // Автор: сотрудник, либо «Система» для авто-событий (крон/вебхук/автоактивация).
    const author = log.employee
      ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
      : "Система"

    const statusFields = ["funnelStatus", "clientStatus"]
    for (const field of statusFields) {
      const c = changes[field] as { old?: unknown; new?: unknown } | undefined
      if (!c) continue
      const oldVal = c.old as string | null
      const newVal = c.new as string | null
      if (oldVal === newVal) continue
      const label = (v: string | null) => (v ? STATUS_LABELS[v] || v : "—")
      const transition = `${label(oldVal)} → ${label(newVal)}`
      events.push({
        id: `audit-${log.id}-${field}`,
        kind: "status_change",
        date: log.createdAt.toISOString(),
        title:
          field === "funnelStatus"
            ? "Смена статуса в воронке"
            : "Смена статуса клиента",
        description: reasonLabel ? `${transition} · ${reasonLabel}` : transition,
        meta: { author, field, reason: reasonRaw },
      })
    }
  }

  // Сортируем по дате убыванию
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return NextResponse.json({ events })
}
