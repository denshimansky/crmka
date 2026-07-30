import { db } from "@/lib/db"
import type { PortalConsentType } from "@prisma/client"
import { effectiveRequiredTypes, type PortalDocsOrg } from "@/lib/portal-consents"
import { getPortalSession, requirePortalAccount, type PortalPayload } from "@/lib/portal-auth"

// Серверный слой данных ЛК родителя: общие выборки для RSC-страниц и
// /api/portal/* — where-условия живут в одном месте.

export const PORTAL_ORG_DOCS_SELECT = {
  portalOfferUrl: true,
  portalPrivacyPolicyUrl: true,
  portalPdnParentConsentUrl: true,
  portalPdnChildConsentUrl: true,
  portalPdnDistributionConsentUrl: true,
  portalMarketingConsentUrl: true,
} as const

export type ConsentState = { granted: boolean; createdAt: Date }

/** Актуальное состояние согласий: последняя запись журнала по каждому типу. */
export async function getLatestConsents(
  tenantId: string,
  clientId: string
): Promise<Map<PortalConsentType, ConsentState>> {
  const rows = await db.clientConsent.findMany({
    where: { tenantId, clientId },
    orderBy: { createdAt: "desc" },
    select: { type: true, granted: true, createdAt: true },
  })
  const map = new Map<PortalConsentType, ConsentState>()
  for (const row of rows) {
    if (!map.has(row.type)) {
      map.set(row.type, { granted: row.granted, createdAt: row.createdAt })
    }
  }
  return map
}

/** Пройден ли гейт: все фактически обязательные согласия даны. */
export async function hasRequiredConsents(
  org: PortalDocsOrg,
  tenantId: string,
  clientId: string
): Promise<boolean> {
  const required = effectiveRequiredTypes(org)
  const latest = await getLatestConsents(tenantId, clientId)
  return required.every((type) => latest.get(type)?.granted)
}

// ─── Guard data-роутов ───

export type PortalOrg = {
  id: string
  name: string
  inn: string | null
  portalSlug: string | null
  currency: string
} & PortalDocsOrg

export type PortalContext =
  | { ok: true; session: PortalPayload; org: PortalOrg }
  | { ok: false; status: 401 | 403; code?: "CONSENTS_REQUIRED" }

/**
 * Полный guard data-запроса портала: живая сессия v2 + активная учётка +
 * пройденный гейт согласий (проверка по БД, не по JWT).
 */
export async function getPortalContext(): Promise<PortalContext> {
  const session = await getPortalSession()
  if (!session) return { ok: false, status: 401 }

  const account = await requirePortalAccount(session)
  if (!account) return { ok: false, status: 401 }

  const org = await db.organization.findUnique({
    where: { id: session.tenantId },
    select: { id: true, name: true, inn: true, portalSlug: true, currency: true, ...PORTAL_ORG_DOCS_SELECT },
  })
  if (!org) return { ok: false, status: 401 }

  if (!(await hasRequiredConsents(org, session.tenantId, session.clientId))) {
    return { ok: false, status: 403, code: "CONSENTS_REQUIRED" }
  }

  return { ok: true, session, org }
}

/**
 * Сессия кабинета для RSC-страниц /p/[slug]/cabinet: валидная сессия v2 этого
 * тенанта + активная учётка. gatePassed — пройден ли гейт согласий (страницы
 * при false рендерят null, гейт показывает layout).
 */
export async function getCabinetSession(
  slug: string
): Promise<{ session: PortalPayload; org: PortalOrg; gatePassed: boolean } | null> {
  const org = await getPortalOrgBySlug(slug)
  if (!org) return null
  const session = await getPortalSession()
  if (!session || session.tenantId !== org.id) return null
  const account = await requirePortalAccount(session)
  if (!account) return null
  const gatePassed = await hasRequiredConsents(org, session.tenantId, session.clientId)
  return { session, org, gatePassed }
}

/** Проверка «подопечный принадлежит клиенту» для wardKey из URL. */
export async function isValidWardKey(
  tenantId: string,
  clientId: string,
  wardKey: string
): Promise<boolean> {
  if (wardKey === SELF_WARD_KEY) return true
  const ward = await db.ward.findFirst({
    where: { id: wardKey, clientId, tenantId },
    select: { id: true },
  })
  return Boolean(ward)
}

// ─── Разрез по подопечному ───
// wardKey: id подопечного либо "self" — псевдо-профиль для данных без wardId
// (взрослые клиенты / legacy-абонементы, где подопечный не указан).

export const SELF_WARD_KEY = "self"

function wardFilter(wardKey: string): { wardId: string | null } {
  return { wardId: wardKey === SELF_WARD_KEY ? null : wardKey }
}

/** Организация по слагу — для layout /p/[slug]. */
export function getPortalOrgBySlug(slug: string) {
  return db.organization.findUnique({
    where: { portalSlug: slug },
    select: { id: true, name: true, inn: true, portalSlug: true, currency: true, ...PORTAL_ORG_DOCS_SELECT },
  })
}

/** Клиент-владелец кабинета. */
export function getPortalClient(tenantId: string, clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patronymic: true,
      phone: true,
      email: true,
      clientBalance: true,
      branchId: true,
      lastBranchId: true,
    },
  })
}

/**
 * Подопечные для переключателя + признак псевдо-профиля «Я»: есть ли у клиента
 * абонементы или зачисления без wardId (иначе такие данные выпали бы из разреза).
 */
export async function getPortalWards(tenantId: string, clientId: string) {
  const [wards, selfSubscription, selfEnrollment] = await Promise.all([
    db.ward.findMany({
      where: { clientId, tenantId },
      orderBy: [{ firstName: "asc" }, { createdAt: "asc" }],
      select: { id: true, firstName: true, lastName: true, birthDate: true },
    }),
    db.subscription.findFirst({
      where: { tenantId, clientId, wardId: null, deletedAt: null },
      select: { id: true },
    }),
    db.groupEnrollment.findFirst({
      where: { tenantId, clientId, wardId: null, isActive: true, deletedAt: null },
      select: { id: true },
    }),
  ])
  return { wards, hasSelfProfile: Boolean(selfSubscription || selfEnrollment) }
}

/**
 * Активные абонементы подопечного (по образцу crm/wards/[id]): pending/active
 * текущего или будущего периода; пакетные (periodYear=null) — по expiresAt.
 * remainingLessons = totalLessons − списанные (attendanceType.chargesSubscription).
 */
export async function getWardSubscriptions(tenantId: string, clientId: string, wardKey: string) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      clientId,
      ...wardFilter(wardKey),
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
      type: true,
      status: true,
      periodYear: true,
      periodMonth: true,
      totalLessons: true,
      finalAmount: true,
      balance: true,
      startDate: true,
      endDate: true,
      expiresAt: true,
      direction: { select: { name: true, color: true } },
      group: {
        select: {
          name: true,
          branch: { select: { id: true, name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  })

  // Списанные занятия — оптом по всем абонементам
  const ids = subscriptions.map((s) => s.id)
  const consumed = ids.length
    ? await db.attendance.groupBy({
        by: ["subscriptionId"],
        where: {
          tenantId,
          subscriptionId: { in: ids },
          attendanceType: { chargesSubscription: true },
        },
        _count: { _all: true },
      })
    : []
  const consumedMap = new Map(consumed.map((c) => [c.subscriptionId, c._count._all]))

  return subscriptions.map((s) => ({
    ...s,
    consumedLessons: consumedMap.get(s.id) || 0,
    remainingLessons: Math.max(0, s.totalLessons - (consumedMap.get(s.id) || 0)),
  }))
}

/** Расписание подопечного на 14 дней + запланированные пробные. */
export async function getWardSchedule(tenantId: string, clientId: string, wardKey: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 14)

  const enrollments = await db.groupEnrollment.findMany({
    where: { tenantId, clientId, ...wardFilter(wardKey), isActive: true, deletedAt: null },
    select: { groupId: true },
  })
  const groupIds = enrollments.map((e) => e.groupId)

  const lessons = groupIds.length
    ? await db.lesson.findMany({
        where: {
          tenantId,
          groupId: { in: groupIds },
          date: { gte: today, lte: horizon },
          status: "scheduled",
        },
        select: {
          id: true,
          date: true,
          startTime: true,
          durationMinutes: true,
          group: {
            select: {
              name: true,
              direction: { select: { name: true, color: true } },
              room: { select: { name: true } },
            },
          },
          instructor: { select: { firstName: true, lastName: true } },
          substituteInstructor: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 50,
      })
    : []

  const trials = await db.trialLesson.findMany({
    where: { tenantId, clientId, ...wardFilter(wardKey), status: "scheduled" },
    select: {
      id: true,
      scheduledDate: true,
      startTime: true,
      durationMinutes: true,
      lesson: { select: { startTime: true, durationMinutes: true } },
      group: {
        select: {
          name: true,
          direction: { select: { name: true, color: true } },
          room: { select: { name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
      direction: { select: { name: true, color: true } },
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { scheduledDate: "asc" },
    take: 10,
  })

  const instructorName = (i: { firstName: string | null; lastName: string | null } | null) =>
    i ? [i.lastName, i.firstName].filter(Boolean).join(" ") : null

  const regular = lessons.map((l) => ({
    id: l.id,
    date: l.date,
    startTime: l.startTime,
    durationMinutes: l.durationMinutes,
    groupName: l.group.name,
    directionName: l.group.direction.name,
    directionColor: l.group.direction.color,
    roomName: l.group.room.name,
    instructorName: instructorName(l.substituteInstructor || l.instructor),
    isTrial: false,
  }))

  const trial = trials.map((t) => ({
    id: t.id,
    date: t.scheduledDate,
    startTime: t.lesson?.startTime || t.startTime || "—",
    durationMinutes: t.lesson?.durationMinutes || t.durationMinutes || 0,
    groupName: t.group?.name || "Индивидуально",
    directionName: t.group?.direction.name || t.direction?.name || "Пробное занятие",
    directionColor: t.group?.direction.color || t.direction?.color || null,
    roomName: t.group?.room.name || null,
    instructorName: instructorName(t.group?.instructor || t.instructor || null),
    isTrial: true,
  }))

  return [...regular, ...trial].sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime()
    if (d !== 0) return d
    return a.startTime.localeCompare(b.startTime)
  })
}

/**
 * Посещения подопечного для родителя: только прошедшие и без промежуточного
 * «Не был» (no_show — причину ещё уточняют). Деньги не отдаём.
 */
export async function getWardAttendances(
  tenantId: string,
  clientId: string,
  wardKey: string,
  { offset = 0, take = 30 }: { offset?: number; take?: number } = {}
) {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const baseWhere = {
    tenantId,
    clientId,
    ...wardFilter(wardKey),
    lesson: { date: { lte: today } },
  }

  const [visited, missed, makeups] = await Promise.all([
    db.attendance.count({
      where: { ...baseWhere, attendanceType: { code: { in: ["present", "makeup"] } } },
    }),
    db.attendance.count({
      where: { ...baseWhere, attendanceType: { code: { in: ["absent", "excused"] } } },
    }),
    db.attendance.count({ where: { ...baseWhere, isMakeup: true } }),
  ])

  const rows = await db.attendance.findMany({
    where: {
      ...baseWhere,
      attendanceType: { code: { not: "no_show" } },
    },
    select: {
      id: true,
      isTrial: true,
      isMakeup: true,
      lesson: {
        select: {
          date: true,
          startTime: true,
          group: { select: { name: true, direction: { select: { name: true, color: true } } } },
        },
      },
      attendanceType: { select: { name: true, code: true, chargesSubscription: true } },
      absenceReason: { select: { name: true } },
    },
    orderBy: [{ lesson: { date: "desc" } }, { lesson: { startTime: "desc" } }],
    skip: offset,
    take: take + 1, // +1 — признак hasMore
  })

  const hasMore = rows.length > take
  return {
    hasMore,
    summary: { visited, missed, makeups },
    items: rows.slice(0, take).map((a) => ({
      id: a.id,
      date: a.lesson.date,
      startTime: a.lesson.startTime,
      groupName: a.lesson.group.name,
      directionName: a.lesson.group.direction.name,
      directionColor: a.lesson.group.direction.color,
      typeName: a.attendanceType.name,
      typeCode: a.attendanceType.code,
      charges: a.attendanceType.chargesSubscription,
      isTrial: a.isTrial,
      isMakeup: a.isMakeup,
      absenceReason: a.absenceReason?.name || null,
    })),
  }
}

export type WardTimelineEvent = {
  id: string
  date: Date
  kind: "subscription_created" | "subscription_closed" | "subscription_withdrawn" | "trial_scheduled" | "trial_attended"
  title: string
  detail: string | null
}

/**
 * Лёгкая лента истории подопечного для родителя: абонементы и пробные.
 * Без денег, причин отчисления и служебных событий CRM.
 */
export async function getWardTimeline(
  tenantId: string,
  clientId: string,
  wardKey: string
): Promise<WardTimelineEvent[]> {
  const [subscriptions, trials] = await Promise.all([
    db.subscription.findMany({
      where: { tenantId, clientId, ...wardFilter(wardKey), deletedAt: null },
      select: {
        id: true,
        status: true,
        createdAt: true,
        withdrawalDate: true,
        endDate: true,
        updatedAt: true,
        periodYear: true,
        periodMonth: true,
        direction: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.trialLesson.findMany({
      where: { tenantId, clientId, ...wardFilter(wardKey) },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        attendedAt: true,
        createdAt: true,
        direction: { select: { name: true } },
        group: { select: { direction: { select: { name: true } } } },
      },
      orderBy: { scheduledDate: "desc" },
      take: 20,
    }),
  ])

  const periodLabel = (y: number | null, m: number | null) =>
    y && m ? `${String(m).padStart(2, "0")}.${y}` : null

  const events: WardTimelineEvent[] = []
  for (const s of subscriptions) {
    const period = periodLabel(s.periodYear, s.periodMonth)
    events.push({
      id: `${s.id}-created`,
      date: s.createdAt,
      kind: "subscription_created",
      title: `Оформлен абонемент — ${s.direction.name}`,
      detail: period,
    })
    if (s.withdrawalDate) {
      events.push({
        id: `${s.id}-withdrawn`,
        date: s.withdrawalDate,
        kind: "subscription_withdrawn",
        title: `Завершены занятия — ${s.direction.name}`,
        detail: period,
      })
    } else if (s.status === "closed") {
      events.push({
        id: `${s.id}-closed`,
        date: s.endDate || s.updatedAt,
        kind: "subscription_closed",
        title: `Абонемент завершён — ${s.direction.name}`,
        detail: period,
      })
    }
  }
  for (const t of trials) {
    const directionName = t.group?.direction.name || t.direction?.name || null
    events.push({
      id: `${t.id}-scheduled`,
      date: t.createdAt,
      kind: "trial_scheduled",
      title: "Запись на пробное занятие",
      detail: directionName,
    })
    if (t.status === "attended") {
      events.push({
        id: `${t.id}-attended`,
        date: t.attendedAt || t.scheduledDate,
        kind: "trial_attended",
        title: "Пробное занятие посещено",
        detail: directionName,
      })
    }
  }

  return events.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 50)
}

/** Оплаты клиента (клиентский уровень — у Payment нет wardId). */
export async function getClientPayments(
  tenantId: string,
  clientId: string,
  { offset = 0, take = 20 }: { offset?: number; take?: number } = {}
) {
  const rows = await db.payment.findMany({
    where: { tenantId, clientId, deletedAt: null },
    select: {
      id: true,
      date: true,
      amount: true,
      type: true,
      method: true,
      subscription: { select: { direction: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
    skip: offset,
    take: take + 1,
  })
  const hasMore = rows.length > take
  return {
    hasMore,
    items: rows.slice(0, take).map((p) => ({
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      type: p.type,
      method: p.method,
      directionName: p.subscription?.direction.name || null,
    })),
  }
}

export type BranchContacts = {
  id: string
  name: string
  address: string | null
  contactPhone: string | null
  contactWhatsapp: string | null
  contactTelegram: string | null
  contactMax: string | null
}

const BRANCH_CONTACTS_SELECT = {
  id: true,
  name: true,
  address: true,
  contactPhone: true,
  contactWhatsapp: true,
  contactTelegram: true,
  contactMax: true,
} as const

/**
 * Контакты филиала для разреза подопечного: филиалы групп активных абонементов;
 * fallback — филиалы групп активных зачислений → lastBranchId → branchId клиента.
 */
export async function getWardBranchContacts(
  tenantId: string,
  clientId: string,
  wardKey: string
): Promise<BranchContacts[]> {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const subs = await db.subscription.findMany({
    where: {
      tenantId,
      clientId,
      ...wardFilter(wardKey),
      deletedAt: null,
      withdrawalDate: null,
      status: { in: ["pending", "active"] },
      OR: [
        { periodYear: null },
        { periodYear: { gt: currentYear } },
        { periodYear: currentYear, periodMonth: { gte: currentMonth } },
      ],
    },
    select: { group: { select: { branch: { select: BRANCH_CONTACTS_SELECT } } } },
  })
  let branches = uniqueBranches(subs.map((s) => s.group.branch))

  if (branches.length === 0) {
    const enrollments = await db.groupEnrollment.findMany({
      where: { tenantId, clientId, ...wardFilter(wardKey), isActive: true, deletedAt: null },
      select: { group: { select: { branch: { select: BRANCH_CONTACTS_SELECT } } } },
    })
    branches = uniqueBranches(enrollments.map((e) => e.group.branch))
  }

  if (branches.length === 0) {
    const client = await db.client.findFirst({
      where: { id: clientId, tenantId },
      select: { branchId: true, lastBranchId: true },
    })
    const branchId = client?.lastBranchId || client?.branchId
    if (branchId) {
      const branch = await db.branch.findFirst({
        where: { id: branchId, tenantId, deletedAt: null },
        select: BRANCH_CONTACTS_SELECT,
      })
      if (branch) branches = [branch]
    }
  }

  return branches
}

function uniqueBranches(list: (BranchContacts | null)[]): BranchContacts[] {
  const map = new Map<string, BranchContacts>()
  for (const b of list) {
    if (b && !map.has(b.id)) map.set(b.id, b)
  }
  return [...map.values()]
}
