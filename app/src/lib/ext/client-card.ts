import { db } from "@/lib/db"
import { formatAge } from "@/lib/age"
import { clientStateLabel } from "@/lib/clients/state-label"
import { scopeClientByBranch } from "@/lib/client-segments"
import { currencySymbol } from "@/lib/currency"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import type { ExtContext } from "@/lib/ext-auth"

/**
 * Карточка клиента для панели расширения — всё одним запросом
 * (docs/messenger-extension.md §6).
 *
 * Почему не переиспользуем готовые эндпоинты: панель открывается на каждую
 * смену чата, а карточка собирается из 6 источников. Дёргать GET /api/clients/[id],
 * /subscriptions, /schedule, /payments по отдельности — это 4-5 круговых
 * задержек и лишний трафик; плюс GET /api/payments требует finance.view, которого
 * у администратора может не быть, и панель осталась бы без платежей.
 *
 * Инварианты:
 *   • tenantId в каждом запросе (RLS в проекте не работает);
 *   • филиальный scope — как в CRM, иначе через панель утечёт чужой филиал;
 *   • телефоны маскируются по роли (instructorsSeePhones);
 *   • Decimal → number, даты-«дни» → строка YYYY-MM-DD (иначе часовой пояс
 *     браузера сдвинет дату занятия на сутки).
 */

/** Дата-«день» (@db.Date) → «YYYY-MM-DD» без влияния часового пояса. */
function dayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function personName(p: { firstName: string | null; lastName: string | null } | null): string | null {
  if (!p) return null
  return [p.lastName, p.firstName].filter(Boolean).join(" ").trim() || null
}

export interface ExtClientCard {
  /** Символ валюты организации: панель не должна зашивать рубль. */
  currencySymbol: string
  client: {
    id: string
    name: string
    phone: string | null
    phone2: string | null
    stateLabel: string
    funnelStatus: string
    clientStatus: string | null
    balance: number
    branchName: string | null
    comment: string | null
    handles: { telegram: string | null; vk: string | null; max: string | null }
    cardPath: string
  }
  wards: Array<{
    id: string
    name: string
    ageLabel: string | null
    lastLesson: { date: string; startTime: string; group: string | null; direction: string | null; mark: string | null } | null
    nextLesson: { date: string; startTime: string; group: string | null; direction: string | null; instructor: string | null; isTrial: boolean } | null
  }>
  subscriptions: Array<{
    id: string
    wardId: string | null
    direction: string | null
    group: string | null
    status: string
    period: string | null
    totalLessons: number
    consumedLessons: number
    remainingLessons: number
    debt: number
    finalAmount: number
  }>
  payments: Array<{ id: string; date: string; amount: number; type: string; method: string | null; direction: string | null }>
  communications: Array<{
    id: string
    at: string
    channel: string
    direction: string
    type: string
    content: string | null
    employeeName: string | null
  }>
}

export async function buildClientCard(
  ctx: ExtContext,
  clientId: string,
): Promise<ExtClientCard | null> {
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patronymic: true,
      phone: true,
      phone2: true,
      funnelStatus: true,
      clientStatus: true,
      clientBalance: true,
      comment: true,
      telegram: true,
      vk: true,
      max: true,
      branch: { select: { name: true } },
      wards: {
        orderBy: [{ firstName: "asc" }, { createdAt: "asc" }],
        select: { id: true, firstName: true, lastName: true, birthDate: true },
      },
    },
  })
  if (!client) return null

  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Валюта организации: суммы по курсу не пересчитываются, меняется только
  // символ (см. lib/currency.ts) — но панель обязана показывать её, а не ₽.
  // Запрос стартует здесь, ждём его после основного пакета: так он идёт
  // параллельно и ничего не задерживает.
  const organizationPromise = db.organization.findUnique({
    where: { id: ctx.tenantId },
    select: { currency: true },
  })

  const [subscriptions, payments, communications, enrollments, lastAttendances] = await Promise.all([
    // Активные абонементы. Критерий — как в ЛК родителя: pending/active, не
    // отчислен, период текущий или будущий; пакетные (periodYear = NULL) живут
    // по expiresAt и наивным фильтром по периоду выпали бы.
    db.subscription.findMany({
      where: {
        tenantId: ctx.tenantId,
        clientId,
        deletedAt: null,
        withdrawalDate: null,
        status: { in: ["pending", "active"] },
        OR: [
          { periodYear: null },
          { periodYear: { gt: currentYear } },
          { periodYear: currentYear, periodMonth: { gte: currentMonth } },
        ],
      },
      select: {
        id: true,
        wardId: true,
        status: true,
        periodYear: true,
        periodMonth: true,
        totalLessons: true,
        finalAmount: true,
        balance: true,
        direction: { select: { name: true } },
        group: { select: { name: true } },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
    // Последние платежи. transfer_in — виртуальное плечо перевода, кассу не
    // двигает и клиенту ничего не говорит: скрываем.
    db.payment.findMany({
      where: {
        tenantId: ctx.tenantId,
        clientId,
        deletedAt: null,
        type: { not: "transfer_in" },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        type: true,
        method: true,
        subscription: { select: { direction: { select: { name: true } } } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    // Кросс-канальная история: последние сообщения по ВСЕМ каналам сразу — ради
    // этого расширение и пишет переписку в CRM. Сортировка по времени сообщения
    // (sentAt), а не по времени записи в БД: заливка идёт задним числом.
    // Ровно 10 строк: панель узкая, а вся история и так открывается в CRM по
    // ссылке с именем клиента.
    db.communication.findMany({
      where: { tenantId: ctx.tenantId, clientId },
      select: {
        id: true,
        type: true,
        channel: true,
        direction: true,
        content: true,
        sentAt: true,
        createdAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      // nulls: "last" — как в лентах CRM (api/clients/[id]/communications и
      // timeline). Без него Postgres при DESC ставит NULL первыми, и панель
      // показывала бы не последние 10 сообщений, а 10 «безвременных».
      orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 10,
    }),
    db.groupEnrollment.findMany({
      where: { tenantId: ctx.tenantId, clientId, isActive: true, deletedAt: null },
      select: { wardId: true, groupId: true },
    }),
    // Последняя отметка по каждому подопечному — берём с запасом и разбираем в
    // памяти: отдельный запрос на каждого ребёнка дороже. isPending = «не
    // отмечен», такие занятия не показываем как состоявшиеся.
    db.attendance.findMany({
      where: {
        tenantId: ctx.tenantId,
        clientId,
        isPending: false,
        lesson: { date: { lte: endOfToday } },
      },
      select: {
        wardId: true,
        attendanceType: { select: { name: true } },
        lesson: {
          select: {
            date: true,
            startTime: true,
            group: { select: { name: true, direction: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ lesson: { date: "desc" } }, { lesson: { startTime: "desc" } }],
      take: 60,
    }),
  ])

  // Ближайшее будущее занятие — от активных зачислений подопечного. Будущие
  // attendance не заводятся заранее, поэтому идём от групп, а не от отметок.
  const groupIds = [...new Set(enrollments.map((e) => e.groupId))]
  const upcoming = groupIds.length
    ? await db.lesson.findMany({
        where: {
          tenantId: ctx.tenantId,
          groupId: { in: groupIds },
          date: { gte: today },
          status: "scheduled",
        },
        select: {
          date: true,
          startTime: true,
          groupId: true,
          group: { select: { name: true, direction: { select: { name: true } } } },
          instructor: { select: { firstName: true, lastName: true } },
          substituteInstructor: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 40,
      })
    : []

  const trials = await db.trialLesson.findMany({
    where: { tenantId: ctx.tenantId, clientId, status: "scheduled" },
    select: {
      wardId: true,
      scheduledDate: true,
      startTime: true,
      lesson: { select: { startTime: true } },
      group: { select: { name: true, direction: { select: { name: true } } } },
      direction: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { scheduledDate: "asc" },
    take: 10,
  })

  const groupsByWard = new Map<string | null, Set<string>>()
  for (const e of enrollments) {
    const key = e.wardId
    if (!groupsByWard.has(key)) groupsByWard.set(key, new Set())
    groupsByWard.get(key)!.add(e.groupId)
  }

  const wards = client.wards.map((ward) => {
    // Исторические записи без wardId (импорт, старые зачисления) относим к
    // единственному ребёнку — иначе у него пусто, хотя занятия есть.
    const soleWard = client.wards.length === 1
    const wardGroups = groupsByWard.get(ward.id) ?? (soleWard ? groupsByWard.get(null) : undefined)

    const last = lastAttendances.find(
      (a) => a.wardId === ward.id || (soleWard && a.wardId === null),
    )
    const nextLesson = upcoming.find((l) => wardGroups?.has(l.groupId))
    const nextTrial = trials.find((t) => t.wardId === ward.id || (soleWard && t.wardId === null))

    // Пробное может быть раньше регулярного — показываем то, что ближе.
    const useTrial =
      nextTrial &&
      (!nextLesson || nextTrial.scheduledDate.getTime() < nextLesson.date.getTime())

    return {
      id: ward.id,
      name: [ward.lastName, ward.firstName].filter(Boolean).join(" ").trim() || "Без имени",
      // null (а не «—»), чтобы панель сама решила, показывать ли строку: у
      // импортированных клиентов даты рождения часто нет.
      ageLabel: ward.birthDate ? formatAge(ward.birthDate, now) : null,
      lastLesson: last
        ? {
            date: dayString(last.lesson.date),
            startTime: last.lesson.startTime,
            group: last.lesson.group?.name ?? null,
            direction: last.lesson.group?.direction?.name ?? null,
            mark: last.attendanceType?.name ?? null,
          }
        : null,
      nextLesson: useTrial
        ? {
            date: dayString(nextTrial!.scheduledDate),
            startTime: nextTrial!.lesson?.startTime || nextTrial!.startTime || "—",
            group: nextTrial!.group?.name ?? "Индивидуально",
            direction: nextTrial!.group?.direction?.name ?? nextTrial!.direction?.name ?? "Пробное",
            instructor: personName(nextTrial!.instructor),
            isTrial: true,
          }
        : nextLesson
          ? {
              date: dayString(nextLesson.date),
              startTime: nextLesson.startTime,
              group: nextLesson.group?.name ?? null,
              direction: nextLesson.group?.direction?.name ?? null,
              instructor: personName(nextLesson.substituteInstructor || nextLesson.instructor),
              isTrial: false,
            }
          : null,
    }
  })

  // Списанные занятия по абонементам — одним группировочным запросом.
  const subIds = subscriptions.map((s) => s.id)
  const consumed = subIds.length
    ? await db.attendance.groupBy({
        by: ["subscriptionId"],
        where: {
          tenantId: ctx.tenantId,
          subscriptionId: { in: subIds },
          attendanceType: { chargesSubscription: true },
        },
        _count: { _all: true },
      })
    : []
  const consumedMap = new Map(consumed.map((c) => [c.subscriptionId, c._count._all]))
  const organization = await organizationPromise

  return {
    currencySymbol: currencySymbol(organization?.currency),
    client: {
      id: client.id,
      name:
        [client.lastName, client.firstName, client.patronymic].filter(Boolean).join(" ").trim() ||
        "Без имени",
      phone: maskPhone(client.phone, ctx.role, ctx.instructorsSeePhones),
      phone2: maskPhone(client.phone2, ctx.role, ctx.instructorsSeePhones),
      stateLabel: clientStateLabel(client.funnelStatus, client.clientStatus),
      funnelStatus: client.funnelStatus,
      clientStatus: client.clientStatus,
      // Деньги клиента: минус = долг (в отличие от Subscription.balance, где
      // долг — это плюс). Не перепутать при отрисовке.
      balance: Number(client.clientBalance),
      branchName: client.branch?.name ?? null,
      comment: client.comment,
      handles: { telegram: client.telegram, vk: client.vk, max: client.max },
      // Путь, а не абсолютный URL: адрес CRM расширение знает само.
      cardPath: `/crm/clients/${client.id}`,
    },
    wards,
    subscriptions: subscriptions.map((s) => {
      const used = consumedMap.get(s.id) ?? 0
      return {
        id: s.id,
        wardId: s.wardId,
        direction: s.direction?.name ?? null,
        group: s.group?.name ?? null,
        status: s.status,
        period:
          s.periodYear && s.periodMonth
            ? `${String(s.periodMonth).padStart(2, "0")}.${s.periodYear}`
            : null,
        totalLessons: s.totalLessons,
        consumedLessons: used,
        remainingLessons: Math.max(0, s.totalLessons - used),
        // Долг по абонементу — положительный balance («сколько осталось оплатить»).
        debt: Math.max(0, Number(s.balance)),
        finalAmount: Number(s.finalAmount),
      }
    }),
    payments: payments.map((p) => ({
      id: p.id,
      date: dayString(p.date),
      amount: Number(p.amount),
      type: p.type,
      method: p.method,
      direction: p.subscription?.direction?.name ?? null,
    })),
    communications: communications.map((c) => ({
      id: c.id,
      at: (c.sentAt ?? c.createdAt).toISOString(),
      channel: c.channel,
      direction: c.direction,
      type: c.type,
      content: c.content,
      employeeName: personName(c.employee),
    })),
  }
}
