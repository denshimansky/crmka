// Этап 2: приём промежуточного xlsx + деньги.xlsx, мерж балансов,
// группировка по телефону → клиенты + подопечные в БД.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { readSheet, normPhone, normName } from "./parse-xlsx"
import { parseStatus, toDbStatus, topStatus, type LeadStatus } from "./status-map"

interface LeadFileRow {
  parent: string
  phone: string
  child: string
  socials: string
  birthDate: string
  status: LeadStatus | null
  balance: number
  needsReview: boolean
  rowIdx: number
}

interface MoneyFileRow {
  contractor: string
  balance: number
}

export interface NeedsReview {
  rowIdx: number
  fio: string
  phone: string
}

export interface SyncReport {
  ok: true
  clientsCreated: number
  clientsMerged: number
  wardsCreated: number
  totalBalance: number
  balanceMissing: number
  warnings: string[]
}

export interface SyncBlocked {
  ok: false
  reason: "needs_review"
  rows: NeedsReview[]
}

function loadLeadsFile(buffer: Buffer): LeadFileRow[] {
  // Шапка на первой строке (этап 1 пишет в этом формате).
  const sheet = readSheet(buffer, { headerRow: 0 })
  const out: LeadFileRow[] = []
  sheet.forEach((row, idx) => {
    const parent = String(row["Фамилия Имя родителя"] ?? "").trim()
    const phone = normPhone(row["Номер_телефона"] as string | null)
    const child = String(row["Ребёнок"] ?? "").trim()
    if (!child) return
    const socials = String(row["Соцсети"] ?? "").trim()
    const birthDate = String(row["Дата_рождения"] ?? "").trim()
    const status = parseStatus(String(row["Статус"] ?? ""))
    const balanceRaw = row["Баланс"]
    const balance =
      balanceRaw === "" || balanceRaw === null || balanceRaw === undefined
        ? 0
        : Number(balanceRaw)
    const review = String(row["Проверить"] ?? "").trim().toLowerCase()
    out.push({
      parent,
      phone,
      child,
      socials,
      birthDate,
      status,
      balance: Number.isFinite(balance) ? balance : 0,
      needsReview: review === "да" || review === "yes" || review === "true",
      rowIdx: idx + 2, // +1 за заголовок, +1 для 1-based
    })
  })
  return out
}

function loadMoneyFile(buffer: Buffer): Map<string, number> {
  const sheet = readSheet(buffer, { headerRow: 0 })
  const out = new Map<string, number>()
  for (const row of sheet) {
    const contractor = String(row["Контрагент"] ?? "").trim()
    if (!contractor || contractor.toLowerCase() === "итого") continue
    const balRaw = row["Баланс на сегодня"]
    const bal = Number(balRaw)
    if (!Number.isFinite(bal)) continue
    const key = normName(contractor)
    out.set(key, (out.get(key) ?? 0) + bal)
  }
  return out
}

function parseDob(raw: string): Date | null {
  if (!raw) return null
  const s = raw.trim()
  // DD.MM.YYYY
  const m1 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m1) {
    const d = new Date(`${m1[3]}-${m1[2]}-${m1[1]}T00:00:00Z`)
    return isNaN(d.getTime()) ? null : d
  }
  // DD.MM.YY
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (m2) {
    const yy = Number(m2[3])
    const year = yy < 50 ? 2000 + yy : 1900 + yy
    const d = new Date(`${year}-${m2[2]}-${m2[1]}T00:00:00Z`)
    return isNaN(d.getTime()) ? null : d
  }
  // YYYY-MM-DD
  const m3 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m3) {
    const d = new Date(`${s}T00:00:00Z`)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function splitFio(fio: string): { firstName: string; lastName: string | null } {
  const parts = fio.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: "", lastName: null }
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  const lastName = parts[0]
  const firstName = parts[1]
  return { firstName, lastName }
}

function splitParent(parent: string): { firstName: string; lastName: string } {
  const parts = parent.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: "", lastName: "" }
  if (parts.length === 1) return { firstName: parts[0], lastName: "" }
  return { firstName: parts.slice(1).join(" "), lastName: parts[0] }
}

export interface SyncOptions {
  leadsBuffer: Buffer
  moneyBuffer: Buffer
  tenantId: string
  createdBy: string | null
}

export async function syncLeads(opts: SyncOptions): Promise<SyncReport | SyncBlocked> {
  const leads = loadLeadsFile(opts.leadsBuffer)
  const reviewBlocked = leads.filter((r) => r.needsReview)
  if (reviewBlocked.length > 0) {
    return {
      ok: false,
      reason: "needs_review",
      rows: reviewBlocked.map((r) => ({ rowIdx: r.rowIdx, fio: r.child, phone: r.phone })),
    }
  }

  // Подмержим балансы из деньги.xlsx по нормализованному ФИО ребёнка.
  const balances = loadMoneyFile(opts.moneyBuffer)
  let balanceMissing = 0
  for (const r of leads) {
    const fromMoney = balances.get(normName(r.child))
    if (fromMoney !== undefined) {
      r.balance = (r.balance ?? 0) + fromMoney
    } else if (!r.balance) {
      balanceMissing++
    }
  }

  // Группировка по телефону = 1 клиент. Если телефон пустой — каждая строка отдельный клиент.
  type Group = { phone: string; rows: LeadFileRow[] }
  const byPhone = new Map<string, Group>()
  for (const r of leads) {
    const key = r.phone || `__solo_${r.rowIdx}`
    const g = byPhone.get(key) ?? { phone: r.phone, rows: [] }
    g.rows.push(r)
    byPhone.set(key, g)
  }

  // Тянем существующих клиентов тенанта по телефонам — для edge case merge.
  const phones = [...byPhone.values()].map((g) => g.phone).filter(Boolean)
  const existingClients = phones.length
    ? await db.client.findMany({
        where: { tenantId: opts.tenantId, deletedAt: null, phone: { in: phones } },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          funnelStatus: true,
          clientStatus: true,
          clientBalance: true,
          wards: { select: { firstName: true, lastName: true } },
        },
      })
    : []
  const existingByPhone = new Map(existingClients.map((c) => [c.phone ?? "", c]))

  const warnings: string[] = []
  let clientsCreated = 0
  let clientsMerged = 0
  let wardsCreated = 0
  let totalBalance = 0

  // Транзакция: одна большая операция.
  await db.$transaction(async (tx) => {
    for (const [, group] of byPhone) {
      const groupStatuses = group.rows
        .map((r) => r.status)
        .filter((s): s is LeadStatus => !!s)
      const top = topStatus(groupStatuses)
      if (!top) {
        warnings.push(`Телефон ${group.phone || "(пусто)"} пропущен: ни одного валидного статуса.`)
        continue
      }
      const groupBalance = group.rows.reduce((s, r) => s + (r.balance || 0), 0)
      const dbStatus = toDbStatus(top)
      const parentName = group.rows[0].parent
      const { firstName, lastName } = splitParent(parentName)
      const socialLink =
        group.rows.map((r) => r.socials).find((s) => s && s.trim()) ?? null

      const existing = group.phone ? existingByPhone.get(group.phone) : undefined

      let clientId: string
      if (existing) {
        // Объединяем: статус по приоритету между текущим и новым, баланс перезаписываем,
        // имя/фамилию сохраняем как было.
        const currentTopFromExisting = inferLeadStatusFromDb(
          existing.funnelStatus,
          existing.clientStatus,
        )
        const merged = currentTopFromExisting
          ? topStatus([currentTopFromExisting, top]) ?? top
          : top
        const mergedDb = toDbStatus(merged)
        await tx.client.update({
          where: { id: existing.id },
          data: {
            funnelStatus: mergedDb.funnelStatus,
            clientStatus: mergedDb.clientStatus,
            clientBalance: new Prisma.Decimal(groupBalance),
            socialLink: existing.wards.length ? undefined : socialLink ?? undefined,
          },
        })
        clientId = existing.id
        clientsMerged++
        warnings.push(
          `Объединён существующий клиент: ${parentName} (${group.phone}). ` +
            `Баланс обновлён до ${groupBalance.toFixed(2)}, статус → ${merged}.`,
        )
      } else {
        const created = await tx.client.create({
          data: {
            tenantId: opts.tenantId,
            firstName: firstName || null,
            lastName: lastName || null,
            phone: group.phone || null,
            socialLink: socialLink ?? null,
            funnelStatus: dbStatus.funnelStatus,
            clientStatus: dbStatus.clientStatus ?? undefined,
            clientBalance: new Prisma.Decimal(groupBalance),
            createdBy: opts.createdBy ?? undefined,
          },
          select: { id: true },
        })
        clientId = created.id
        clientsCreated++
      }
      totalBalance += groupBalance

      // Подопечные: по одному на каждую строку группы.
      const existingWardKeys = new Set(
        (existing?.wards ?? []).map((w) =>
          `${(w.lastName ?? "").toLowerCase()}|${w.firstName.toLowerCase()}`,
        ),
      )
      for (const r of group.rows) {
        const { firstName: wFirst, lastName: wLast } = splitFio(r.child)
        if (!wFirst) continue
        const wardKey = `${(wLast ?? "").toLowerCase()}|${wFirst.toLowerCase()}`
        if (existingWardKeys.has(wardKey)) continue
        await tx.ward.create({
          data: {
            tenantId: opts.tenantId,
            clientId,
            firstName: wFirst,
            lastName: wLast ?? undefined,
            birthDate: parseDob(r.birthDate) ?? undefined,
          },
        })
        wardsCreated++
      }
    }
  })

  // Аудит-метка: с этого момента в течение 7 дней доступна «Очистить базу клиентов».
  if (opts.createdBy) {
    await db.auditLog.create({
      data: {
        tenantId: opts.tenantId,
        employeeId: opts.createdBy,
        action: "leads_import_sync",
        entityType: "system",
        entityId: opts.tenantId,
        changes: { clientsCreated, clientsMerged, wardsCreated, totalBalance },
      },
    })
  }

  return {
    ok: true,
    clientsCreated,
    clientsMerged,
    wardsCreated,
    totalBalance,
    balanceMissing,
    warnings,
  }
}

export async function isWipeAvailable(tenantId: string): Promise<{
  available: boolean
  importedAt: Date | null
  expiresAt: Date | null
}> {
  const last = await db.auditLog.findFirst({
    where: { tenantId, action: "leads_import_sync" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  if (!last) return { available: false, importedAt: null, expiresAt: null }
  const expiresAt = new Date(last.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { available: Date.now() < expiresAt.getTime(), importedAt: last.createdAt, expiresAt }
}

// Восстанавливаем LeadStatus из БД-енумов, если контакт уже был в системе.
function inferLeadStatusFromDb(
  funnel: string,
  client: string | null,
): LeadStatus | null {
  if (client === "churned") return "Выбыл"
  switch (funnel) {
    case "blacklisted": return "Черный список"
    case "archived": return "Архив"
    case "potential": return "Потенциал"
    case "new": return "Лид"
    case "active_client": return null
    default: return null
  }
}
