// Массовая выписка абонементов на следующий период.
// preview — сухой просчёт; apply — транзакция: создаёт pending Subscription.
// clientBalance не трогается: долг живёт на Subscription.balance до момента
// «Оплатить с баланса» (как и в одиночном POST /api/subscriptions).
//
// Что включаем: только календарные абонементы (type=calendar) — пользователь
// явно подтвердил, что массовая выписка нужна именно для них; package идут
// другим механизмом (по сроку годности).
//
// Дубли: для (clientId, wardId, directionId, groupId) пропускаем, если уже
// есть pending/active с пересечением запрашиваемого периода.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { countLessonsForGroup } from "@/lib/schedule/count-lessons"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"

export interface BulkRenewInput {
  tenantId: string
  rangeStart: Date
  rangeEnd: Date
  branchId?: string | null
  directionId?: string | null
  /** Если задано — продлеваем только этот конкретный source-абонемент (точечное продление из карточки клиента). */
  subscriptionId?: string | null
  createdBy?: string | null
}

export interface BulkRenewCandidate {
  sourceSubscriptionId: string
  clientId: string
  clientName: string
  wardId: string | null
  wardName: string | null
  directionId: string
  directionName: string
  groupId: string
  groupName: string
  branchId: string
  branchName: string
  lessonPrice: number
  totalLessons: number
  finalAmount: number
  hasSchedule: boolean
}

export interface BulkRenewSkipped {
  sourceSubscriptionId: string
  clientName: string
  wardName: string | null
  directionName: string
  groupName: string
  reason: "already_renewed" | "no_schedule_lessons"
}

export interface BulkRenewPreview {
  rangeStart: string // YYYY-MM-DD
  rangeEnd: string
  toCreate: BulkRenewCandidate[]
  skipped: BulkRenewSkipped[]
}

interface SourceRow {
  id: string
  clientId: string
  client: { id: string; firstName: string | null; lastName: string | null }
  wardId: string | null
  ward: { id: string; firstName: string; lastName: string | null } | null
  directionId: string
  direction: { id: string; name: string }
  groupId: string
  group: { id: string; name: string; branchId: string; branch: { name: string } }
  lessonPrice: Prisma.Decimal
  startDate: Date
}

function fullClient(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
}

function fullWard(w: { firstName: string; lastName: string | null } | null): string | null {
  if (!w) return null
  return [w.lastName, w.firstName].filter(Boolean).join(" ").trim() || w.firstName
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function loadActiveSources(opts: BulkRenewInput): Promise<SourceRow[]> {
  const where: Prisma.SubscriptionWhereInput = {
    tenantId: opts.tenantId,
    deletedAt: null,
    status: "active",
    type: "calendar",
    // Не продлеваем абонементы с запланированным отчислением — ребёнок уходит.
    scheduledWithdrawalDate: null,
  }
  if (opts.directionId) where.directionId = opts.directionId
  if (opts.branchId) where.group = { branchId: opts.branchId }
  if (opts.subscriptionId) where.id = opts.subscriptionId

  const rows = await db.subscription.findMany({
    where,
    select: {
      id: true,
      clientId: true,
      client: { select: { id: true, firstName: true, lastName: true } },
      wardId: true,
      ward: { select: { id: true, firstName: true, lastName: true } },
      directionId: true,
      direction: { select: { id: true, name: true } },
      groupId: true,
      group: { select: { id: true, name: true, branchId: true, branch: { select: { name: true } } } },
      lessonPrice: true,
      startDate: true,
    },
    orderBy: { startDate: "desc" },
  })

  // На случай нескольких активных строк с одним ключом — оставляем самую свежую.
  const keyToRow = new Map<string, SourceRow>()
  for (const r of rows) {
    const k = `${r.clientId}|${r.wardId ?? ""}|${r.directionId}|${r.groupId}`
    if (!keyToRow.has(k)) keyToRow.set(k, r)
  }
  return [...keyToRow.values()]
}

// Сравнимое число YYYYMMDD. Даты-колонки приходят из БД как UTC-полночь,
// а rangeStart/rangeEnd (parseDay) — как локальная полночь; берём
// соответствующие компоненты, чтобы сравнение календарных дат не зависело от TZ.
function dayNumUTC(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
function dayNumLocal(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

// Последний день месяца (month1 — 1-based) в виде YYYYMMDD.
function monthEndDayNum(year: number, month1: number): number {
  const lastDay = new Date(year, month1, 0).getDate()
  return year * 10000 + month1 * 100 + lastDay
}

// Конец действия календарного абонемента (YYYYMMDD). У импортированных/легаси
// абонементов endDate часто null — тогда период берём по periodYear/periodMonth
// (последний день месяца), а если их нет — по месяцу startDate. Без этого null
// endDate раньше трактовался как «бессрочный», и любой июньский абонемент ложно
// «перекрывал» июль → массовая выписка пропускала всех (баг выписки на след. период).
function calendarEndDayNum(e: {
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  startDate: Date
}): number {
  if (e.endDate) return dayNumUTC(e.endDate)
  if (e.periodYear != null && e.periodMonth != null) {
    return monthEndDayNum(e.periodYear, e.periodMonth)
  }
  return monthEndDayNum(e.startDate.getUTCFullYear(), e.startDate.getUTCMonth() + 1)
}

async function loadCollisions(
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date,
  keys: Array<{ clientId: string; wardId: string | null; directionId: string; groupId: string }>,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set()

  // Кандидаты: pending/active календарные абонементы, чей старт не позже конца
  // диапазона (необходимое условие пересечения). Конец периода вычисляем в JS —
  // в т.ч. для строк с пустым endDate (см. calendarEndDayNum). Так корректно
  // отсекаем только реально пересекающиеся периоды и не считаем «бессрочным»
  // календарный абонемент без endDate.
  const existing = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      type: "calendar",
      startDate: { lte: rangeEnd },
    },
    select: {
      clientId: true,
      wardId: true,
      directionId: true,
      groupId: true,
      startDate: true,
      endDate: true,
      periodYear: true,
      periodMonth: true,
    },
  })

  const startNum = dayNumLocal(rangeStart)
  const endNum = dayNumLocal(rangeEnd)
  const set = new Set<string>()
  for (const e of existing) {
    // Пересечение интервалов: startDate <= rangeEnd И конецПериода >= rangeStart.
    if (dayNumUTC(e.startDate) <= endNum && calendarEndDayNum(e) >= startNum) {
      set.add(`${e.clientId}|${e.wardId ?? ""}|${e.directionId}|${e.groupId}`)
    }
  }
  return set
}

export async function previewBulkRenew(opts: BulkRenewInput): Promise<BulkRenewPreview> {
  const sources = await loadActiveSources(opts)
  const collisionSet = await loadCollisions(
    opts.tenantId,
    opts.rangeStart,
    opts.rangeEnd,
    sources.map((s) => ({
      clientId: s.clientId,
      wardId: s.wardId,
      directionId: s.directionId,
      groupId: s.groupId,
    })),
  )

  // На один пробег по группам обычно немного групп, но запросы countLessonsForGroup
  // делаются последовательно — для 200+ строк это допустимо в 60 сек roundtrip.
  // Кеш по groupId — чтобы не считать одно и то же по нескольким клиентам.
  const groupLessonsCache = new Map<string, { count: number; hasSchedule: boolean }>()

  const toCreate: BulkRenewCandidate[] = []
  const skipped: BulkRenewSkipped[] = []

  for (const s of sources) {
    const key = `${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}`
    const clientName = fullClient(s.client)
    const wardName = fullWard(s.ward)
    if (collisionSet.has(key)) {
      skipped.push({
        sourceSubscriptionId: s.id,
        clientName,
        wardName,
        directionName: s.direction.name,
        groupName: s.group.name,
        reason: "already_renewed",
      })
      continue
    }
    let g = groupLessonsCache.get(s.groupId)
    if (!g) {
      const r = await countLessonsForGroup({
        tenantId: opts.tenantId,
        groupId: s.groupId,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
      })
      g = { count: r.count, hasSchedule: r.hasSchedule }
      groupLessonsCache.set(s.groupId, g)
    }
    if (g.count === 0) {
      skipped.push({
        sourceSubscriptionId: s.id,
        clientName,
        wardName,
        directionName: s.direction.name,
        groupName: s.group.name,
        reason: "no_schedule_lessons",
      })
      continue
    }
    const price = new Prisma.Decimal(s.lessonPrice)
    const finalAmount = price.mul(g.count)
    toCreate.push({
      sourceSubscriptionId: s.id,
      clientId: s.clientId,
      clientName,
      wardId: s.wardId,
      wardName,
      directionId: s.directionId,
      directionName: s.direction.name,
      groupId: s.groupId,
      groupName: s.group.name,
      branchId: s.group.branchId,
      branchName: s.group.branch.name,
      lessonPrice: price.toNumber(),
      totalLessons: g.count,
      finalAmount: finalAmount.toNumber(),
      hasSchedule: g.hasSchedule,
    })
  }

  return {
    rangeStart: ymd(opts.rangeStart),
    rangeEnd: ymd(opts.rangeEnd),
    toCreate,
    skipped,
  }
}

export interface BulkRenewResult {
  created: number
  skipped: number
  totalIssuedAmount: number
}

export async function applyBulkRenew(opts: BulkRenewInput): Promise<BulkRenewResult> {
  const preview = await previewBulkRenew(opts)
  if (preview.toCreate.length === 0) {
    return { created: 0, skipped: preview.skipped.length, totalIssuedAmount: 0 }
  }

  const periodYear = opts.rangeStart.getFullYear()
  const periodMonth = opts.rangeStart.getMonth() + 1
  const comment = `Массовая выписка на период ${preview.rangeStart} – ${preview.rangeEnd}`

  let created = 0
  let totalIssuedAmount = new Prisma.Decimal(0)

  await db.$transaction(async (tx) => {
    const createdSubs: { subId: string; clientId: string }[] = []

    for (const c of preview.toCreate) {
      const lessonPrice = new Prisma.Decimal(c.lessonPrice)
      const totalAmount = lessonPrice.mul(c.totalLessons)
      const finalAmount = totalAmount // discountAmount = 0 в массовой выписке
      const sub = await tx.subscription.create({
        data: {
          tenantId: opts.tenantId,
          clientId: c.clientId,
          wardId: c.wardId,
          directionId: c.directionId,
          groupId: c.groupId,
          type: "calendar",
          status: "pending",
          periodYear,
          periodMonth,
          lessonPrice,
          totalLessons: c.totalLessons,
          totalAmount,
          discountAmount: new Prisma.Decimal(0),
          finalAmount,
          balance: finalAmount,
          startDate: opts.rangeStart,
          endDate: opts.rangeEnd,
          previousSubscriptionId: c.sourceSubscriptionId,
          createdBy: opts.createdBy ?? undefined,
        },
        select: { id: true },
      })
      createdSubs.push({ subId: sub.id, clientId: c.clientId })
      // ADM-04: денормализуем филиал последнего абонемента + счётчик абонементов.
      // clientBalance НЕ трогаем — долг живёт только на Subscription.balance.
      await tx.client.update({
        where: { id: c.clientId },
        data: {
          lastBranchId: c.branchId,
          totalSubscriptionsCount: { increment: 1 },
        },
      })
      created++
      totalIssuedAmount = totalIssuedAmount.add(finalAmount)
    }

    // Скидки v2: один пересчёт на клиента ПОСЛЕ выписки всей его пачки —
    // тип 1 ляжет на все новые абонементы месяца, кроме самого дорогого
    // (порядок создания внутри пачки роли не играет).
    const byClient = new Map<string, string[]>()
    for (const { subId, clientId } of createdSubs) {
      if (!byClient.has(clientId)) byClient.set(clientId, [])
      byClient.get(clientId)!.push(subId)
    }
    for (const [clientId, subIds] of byClient) {
      await recalcClientDiscounts(tx, {
        tenantId: opts.tenantId,
        clientId,
        createdBy: opts.createdBy ?? null,
        newSubscriptionIds: subIds,
      })
    }

    // «Выписано на сумму» — по фактическим finalAmount ПОСЛЕ применения скидок.
    if (createdSubs.length > 0) {
      const issuedAgg = await tx.subscription.aggregate({
        where: { id: { in: createdSubs.map((c) => c.subId) } },
        _sum: { finalAmount: true },
      })
      totalIssuedAmount = new Prisma.Decimal(issuedAgg._sum.finalAmount ?? 0)
    }
  }, {
    // Массовая выписка по всей базе: на крупном тенанте цикл (create абонемента +
    // update клиента + recalcClientDiscounts на каждого) не укладывается в
    // дефолтные 5 с интерактивной транзакции Prisma.
    maxWait: 20_000,
    timeout: 120_000,
  })

  if (opts.createdBy) {
    await db.auditLog.create({
      data: {
        tenantId: opts.tenantId,
        employeeId: opts.createdBy,
        action: "subscriptions_bulk_renew",
        entityType: "system",
        entityId: opts.tenantId,
        changes: {
          rangeStart: preview.rangeStart,
          rangeEnd: preview.rangeEnd,
          created,
          skipped: preview.skipped.length,
          totalIssuedAmount: totalIssuedAmount.toNumber(),
          branchId: opts.branchId ?? null,
          directionId: opts.directionId ?? null,
        },
      },
    })
  }

  return {
    created,
    skipped: preview.skipped.length,
    totalIssuedAmount: totalIssuedAmount.toNumber(),
  }
}
