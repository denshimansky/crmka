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
  include: { account: { select: { name: true } } }
}>
type TimelineAuditLog = Prisma.AuditLogGetPayload<{
  include: { employee: { select: { firstName: true; lastName: true } } }
}>

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
  | "attendance_present"
  | "attendance_absent"
  | "attendance_other"
  | "status_change"

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
          },
          orderBy: { date: "desc" },
          take: 200,
        }),
    db.attendance.findMany({
      where: { tenantId, clientId, ...(wardId ? { wardId } : {}) },
      include: {
        attendanceType: { select: { name: true, code: true } },
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
  ])

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
    if (t.status === "attended" && t.attendedAt) {
      events.push({
        id: `trial-attended-${t.id}`,
        kind: "trial_attended",
        date: t.attendedAt.toISOString(),
        title: "Пробное посещено",
        description: directionName,
      })
    } else if (t.status === "no_show") {
      events.push({
        id: `trial-noshow-${t.id}`,
        kind: "trial_no_show",
        date: t.scheduledDate.toISOString(),
        title: "Не пришёл на пробное",
        description: directionName,
      })
    }
  }

  // --- Абонементы (создание + закрытие)
  for (const s of subscriptions) {
    const wardName = s.ward ? formatWardName(s.ward, "") || null : null
    const directionName = s.direction?.name || ""
    const amount = Number(s.finalAmount)

    events.push({
      id: `sub-created-${s.id}`,
      kind: "subscription_created",
      date: s.createdAt.toISOString(),
      title: "Абонемент создан",
      description: [
        directionName,
        wardName ? `подопечный: ${wardName}` : null,
        s.group ? `группа: ${s.group.name}` : null,
        `сумма: ${amount.toLocaleString("ru-RU")} ₽`,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { subscriptionId: s.id, amount },
    })

    if ((s.status === "closed" || s.status === "withdrawn") && s.withdrawalDate) {
      events.push({
        id: `sub-closed-${s.id}`,
        kind: "subscription_closed",
        date: s.withdrawalDate.toISOString(),
        title: s.status === "withdrawn" ? "Абонемент отчислен" : "Абонемент закрыт",
        description: directionName,
        meta: { subscriptionId: s.id, status: s.status },
      })
    }
  }

  // --- Оплаты + возвраты
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
    events.push({
      id: `pay-${p.id}`,
      kind: isRefund ? "payment_refund" : "payment_in",
      date: p.date.toISOString(),
      title: isRefund
        ? `Возврат ${amount.toLocaleString("ru-RU")} ₽`
        : `Оплата ${amount.toLocaleString("ru-RU")} ₽`,
      description: [
        METHOD_LABELS[p.method] || p.method,
        p.account?.name,
        p.comment,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: { paymentId: p.id, amount, method: p.method },
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
    events.push({
      id: `att-${a.id}`,
      kind: ATT_CODE_KIND[code] || "attendance_other",
      date: a.markedAt.toISOString(),
      title: `${a.attendanceType.name} · ${lessonDate} ${a.lesson.startTime}`,
      description: [directionName, groupName ? `группа: ${groupName}` : null]
        .filter(Boolean)
        .join(" · "),
      meta: { attendanceId: a.id, charge: Number(a.chargeAmount) },
    })
  }

  // --- Смены статуса (Client AuditLog)
  for (const log of auditLogs) {
    const changes = (log.changes as Record<string, { old?: unknown; new?: unknown }> | null) || null
    if (!changes) continue
    const statusFields = ["funnelStatus", "clientStatus"]
    for (const field of statusFields) {
      const c = changes[field]
      if (!c) continue
      const oldVal = c.old as string | null
      const newVal = c.new as string | null
      if (oldVal === newVal) continue
      const author = log.employee
        ? [log.employee.lastName, log.employee.firstName].filter(Boolean).join(" ")
        : null
      events.push({
        id: `audit-${log.id}-${field}`,
        kind: "status_change",
        date: log.createdAt.toISOString(),
        title:
          field === "funnelStatus"
            ? "Смена статуса в воронке"
            : "Смена статуса клиента",
        description: `${oldVal ?? "—"} → ${newVal ?? "—"}`,
        meta: { author, field },
      })
    }
  }

  // Сортируем по дате убыванию
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return NextResponse.json({ events })
}
