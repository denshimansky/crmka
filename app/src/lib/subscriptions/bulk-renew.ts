// Массовая выписка абонементов на следующий период.
// preview — сухой просчёт; apply — транзакция: создаёт pending Subscription
// и через applyBalanceDelta(type=subscription_issued) уводит баланс клиента
// в минус ровно так же, как одиночный POST /api/subscriptions.
//
// Что включаем: только календарные абонементы (type=calendar) — пользователь
// явно подтвердил, что массовая выписка нужна именно для них; package идут
// другим механизмом (по сроку годности).
//
// Дубли: для (clientId, wardId, directionId, groupId) пропускаем, если уже
// есть pending/active с пересечением запрашиваемого периода.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { countLessonsForGroup } from "@/lib/schedule/count-lessons"

export interface BulkRenewInput {
  tenantId: string
  rangeStart: Date
  rangeEnd: Date
  branchId?: string | null
  directionId?: string | null
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
  group: { id: string; name: string; branch: { name: string } }
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
  }
  if (opts.directionId) where.directionId = opts.directionId
  if (opts.branchId) where.group = { branchId: opts.branchId }

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
      group: { select: { id: true, name: true, branch: { select: { name: true } } } },
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

async function loadCollisions(
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date,
  keys: Array<{ clientId: string; wardId: string | null; directionId: string; groupId: string }>,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set()

  // Пересечение интервалов: (existingStart <= rangeEnd) AND (COALESCE(end, start) >= rangeStart)
  // Берём pending+active. Для package endDate=null, но есть expiresAt; здесь работаем
  // только с calendar, у которых обычно есть startDate и endDate в пределах месяца.
  const existing = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      type: "calendar",
      startDate: { lte: rangeEnd },
      OR: [
        { endDate: null, expiresAt: null },
        { endDate: { gte: rangeStart } },
        { endDate: null, expiresAt: { gte: rangeStart } },
      ],
    },
    select: {
      clientId: true,
      wardId: true,
      directionId: true,
      groupId: true,
    },
  })
  const set = new Set<string>()
  for (const e of existing) {
    set.add(`${e.clientId}|${e.wardId ?? ""}|${e.directionId}|${e.groupId}`)
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
      await applyBalanceDelta(tx, {
        tenantId: opts.tenantId,
        clientId: c.clientId,
        delta: finalAmount.negated(),
        type: "subscription_issued",
        refs: { subscriptionId: sub.id, directionId: c.directionId },
        comment,
        createdBy: opts.createdBy ?? null,
      })
      created++
      totalIssuedAmount = totalIssuedAmount.add(finalAmount)
    }
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
