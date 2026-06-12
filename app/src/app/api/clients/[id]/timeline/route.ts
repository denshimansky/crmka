import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { formatWardName } from "@/lib/format-name"

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

/** «MM.YYYY» абонемента или null, если период не заполнен. */
function periodLabel(
  s: { periodMonth: number | null; periodYear: number | null } | null | undefined,
): string | null {
  if (!s?.periodMonth || !s?.periodYear) return null
  return `${String(s.periodMonth).padStart(2, "0")}.${s.periodYear}`
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
  | "subscription_closed"
  | "payment_in"
  | "payment_refund"
  | "subscription_paid_from_balance"
  | "balance_credit"
  | "balance_debit"
  | "attendance_present"
  | "attendance_absent"
  | "attendance_other"
  | "status_change"
  | "template_discount_removed"

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
  ] = await Promise.all([
    wardId
      ? Promise.resolve([] as TimelineCommunication[])
      : db.communication.findMany({
          where: { tenantId, clientId },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
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
  ])

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
  for (const c of communications) {
    const empName = c.employee
      ? [c.employee.lastName, c.employee.firstName].filter(Boolean).join(" ")
      : null
    events.push({
      id: `comm-${c.id}`,
      kind: "communication",
      date: c.createdAt.toISOString(),
      title: COMM_TITLES[c.type] || c.type,
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
        instructorName ? `педагог: ${instructorName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { trialId: t.id },
    })

    // событие итога: пришёл / не пришёл / отменено
    const trialOutcomeDescription = [
      directionName,
      wardName ? `подопечный: ${wardName}` : null,
      instructorName ? `педагог: ${instructorName}` : null,
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
      })
    } else if (t.status === "no_show") {
      events.push({
        id: `trial-noshow-${t.id}`,
        kind: "trial_no_show",
        date: t.scheduledDate.toISOString(),
        title: "Не пришёл на пробное",
        description: trialOutcomeDescription,
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
    const subDescription = [
      directionName,
      wardName ? `подопечный: ${wardName}` : null,
      s.group ? `группа: ${s.group.name}` : null,
      period ? `период: ${period}` : null,
      `сумма: ${amount.toLocaleString("ru-RU")} ₽`,
    ].filter(Boolean)

    events.push({
      id: `sub-created-${s.id}`,
      kind: "subscription_created",
      date: s.createdAt.toISOString(),
      title: "Абонемент создан",
      description: subDescription.join(" · "),
      meta: { subscriptionId: s.id, amount },
    })

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
      ? `Возврат ${Math.abs(amount).toLocaleString("ru-RU")} ₽`
      : isTransferIn
        ? `Списание с баланса в счёт абонемента ${Math.abs(amount).toLocaleString("ru-RU")} ₽`
        : `Оплата ${amount.toLocaleString("ru-RU")} ₽ — пополнение баланса`
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
      meta: { paymentId: p.id, amount, method: p.method },
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
          ? `Закрытие абонемента: +${amount.toLocaleString("ru-RU")} ₽ на баланс`
          : `Закрытие абонемента: долг ${Math.abs(amount).toLocaleString("ru-RU")} ₽`
        : t.type === "correction"
          ? `Корректировка баланса ${amount >= 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ru-RU")} ₽`
          : t.type === "personal_lesson_charge"
            ? `Разовое посещение: ${Math.abs(amount).toLocaleString("ru-RU")} ₽`
            : t.type === "lesson_refund"
              ? `Возврат за занятие: +${amount.toLocaleString("ru-RU")} ₽`
              : t.type === "discount_refund"
                ? `Возврат по скидке: +${amount.toLocaleString("ru-RU")} ₽`
                : t.type === "attendance_revert"
                  ? `Отмена посещения: +${amount.toLocaleString("ru-RU")} ₽`
                  : `Операция (${t.type}) ${amount >= 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ru-RU")} ₽`
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
      meta: { ledgerId: t.id, ledgerType: t.type, amount },
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
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { attendanceId: a.id, charge: Number(a.chargeAmount) },
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
          `(было −${prev.toLocaleString("ru-RU")} ₽).`,
        meta: { subscriptionId: subId, templateName: tplName, previousAmount: prev },
      })
      continue
    }

    const statusFields = ["funnelStatus", "clientStatus"]
    for (const field of statusFields) {
      const c = changes[field] as { old?: unknown; new?: unknown } | undefined
      if (!c) continue
      const oldVal = c.old as string | null
      const newVal = c.new as string | null
      if (oldVal === newVal) continue
      const author = log.employee
        ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
        : null
      const label = (v: string | null) => (v ? STATUS_LABELS[v] || v : "—")
      events.push({
        id: `audit-${log.id}-${field}`,
        kind: "status_change",
        date: log.createdAt.toISOString(),
        title:
          field === "funnelStatus"
            ? "Смена статуса в воронке"
            : "Смена статуса клиента",
        description: `${label(oldVal)} → ${label(newVal)}`,
        meta: { author, field },
      })
    }
  }

  // Сортируем по дате убыванию
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return NextResponse.json({ events })
}
