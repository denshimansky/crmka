// Этап 2: приём промежуточного xlsx + деньги.xlsx, мерж балансов,
// группировка по телефону → клиенты + подопечные в БД.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
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
  /** true, если значение баланса пришло из явной ячейки файла («Баланс» в
   *  Списке лидов или матч в деньги.xlsx). false — это «нет данных», и
   *  трогать существующий clientBalance в БД нельзя. */
  balanceFromFile: boolean
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

export interface CreatedWithoutPhone {
  rowIdx: number
  parent: string
  child: string
}

export interface SyncReport {
  ok: true
  leadsParsed: number
  moneyParsed: number
  clientsCreated: number
  clientsMerged: number
  wardsCreated: number
  clientsCreatedWithoutPhone: number
  withoutPhone: CreatedWithoutPhone[]
  totalBalance: number
  balanceMissing: number
  warnings: string[]
}

export interface SyncEmpty {
  ok: false
  reason: "empty_leads"
  detectedHeaders: string[]
}

export interface SyncBlocked {
  ok: false
  reason: "needs_review"
  rows: NeedsReview[]
}

// Нормализация ключа колонки: lower-case, ё→е, _→пробел, схлопывание пробелов.
function normColKey(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/_/g, " ").replace(/\s+/g, " ")
}

function pickValue(
  row: Record<string, unknown>,
  normMap: Map<string, string>,
  ...aliases: string[]
): unknown {
  for (const alias of aliases) {
    const realKey = normMap.get(normColKey(alias))
    if (realKey !== undefined) {
      const v = row[realKey]
      if (v !== null && v !== undefined && v !== "") return v
    }
  }
  return null
}

function loadLeadsFile(buffer: Buffer): { rows: LeadFileRow[]; headers: string[] } {
  // Шапка на первой строке (этап 1 пишет в этом формате).
  const sheet = readSheet(buffer, { headerRow: 0 })
  if (sheet.length === 0) return { rows: [], headers: [] }
  const headers = Object.keys(sheet[0])
  const normMap = new Map<string, string>()
  for (const h of headers) normMap.set(normColKey(h), h)

  const out: LeadFileRow[] = []
  sheet.forEach((row, idx) => {
    const parent = String(pickValue(row, normMap, "Фамилия Имя родителя") ?? "").trim()
    const phoneRaw = pickValue(row, normMap, "Номер_телефона", "Номер телефона", "Телефон")
    const phone = normPhone(phoneRaw === null ? null : String(phoneRaw))
    const child = String(pickValue(row, normMap, "Ребёнок", "Ребенок", "ФИО") ?? "").trim()
    if (!child) return
    const socials = String(pickValue(row, normMap, "Соцсети") ?? "").trim()
    const birthDate = String(pickValue(row, normMap, "Дата_рождения", "Дата рождения") ?? "").trim()
    const status = parseStatus(String(pickValue(row, normMap, "Статус", "Состояние лида") ?? ""))
    const balanceRaw = pickValue(row, normMap, "Баланс")
    const balanceHasValue =
      balanceRaw !== "" && balanceRaw !== null && balanceRaw !== undefined
    const balance = balanceHasValue ? Number(balanceRaw) : 0
    const reviewRaw = pickValue(row, normMap, "Проверить")
    const review = (reviewRaw === null ? "" : String(reviewRaw)).trim().toLowerCase()
    out.push({
      parent,
      phone,
      child,
      socials,
      birthDate,
      status,
      balance: Number.isFinite(balance) ? balance : 0,
      balanceFromFile: balanceHasValue && Number.isFinite(balance),
      needsReview: review === "да" || review === "yes" || review === "true",
      rowIdx: idx + 2, // +1 за заголовок, +1 для 1-based
    })
  })
  return { rows: out, headers }
}

function loadMoneyFile(buffer: Buffer): {
  balances: Map<string, number>
  rowsParsed: number
  duplicates: { display: string; total: number; count: number }[]
} {
  const sheet = readSheet(buffer, { headerRow: 0 })
  if (sheet.length === 0) return { balances: new Map(), rowsParsed: 0, duplicates: [] }
  const headers = Object.keys(sheet[0])
  const normMap = new Map<string, string>()
  for (const h of headers) normMap.set(normColKey(h), h)

  const out = new Map<string, number>()
  const dupes = new Map<string, { display: string; count: number; total: number }>()
  let rowsParsed = 0
  for (const row of sheet) {
    const contractor = String(pickValue(row, normMap, "Контрагент", "ФИО", "Ребёнок", "Ребенок") ?? "").trim()
    if (!contractor || contractor.toLowerCase() === "итого") continue
    const balRaw = pickValue(row, normMap, "Баланс на сегодня", "Баланс")
    const bal = Number(balRaw)
    if (!Number.isFinite(bal)) continue
    const key = normName(contractor)
    if (out.has(key)) {
      const prev = dupes.get(key) ?? { display: contractor, count: 1, total: out.get(key) ?? 0 }
      dupes.set(key, { display: contractor, count: prev.count + 1, total: prev.total + bal })
    }
    out.set(key, (out.get(key) ?? 0) + bal)
    rowsParsed++
  }
  return { balances: out, rowsParsed, duplicates: [...dupes.values()] }
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
  moneyBuffer: Buffer | null
  tenantId: string
  createdBy: string | null
}

export async function syncLeads(opts: SyncOptions): Promise<SyncReport | SyncBlocked | SyncEmpty> {
  const parsedLeads = loadLeadsFile(opts.leadsBuffer)
  const leads = parsedLeads.rows
  if (leads.length === 0) {
    return { ok: false, reason: "empty_leads", detectedHeaders: parsedLeads.headers }
  }
  const reviewBlocked = leads.filter((r) => r.needsReview)
  if (reviewBlocked.length > 0) {
    return {
      ok: false,
      reason: "needs_review",
      rows: reviewBlocked.map((r) => ({ rowIdx: r.rowIdx, fio: r.child, phone: r.phone })),
    }
  }

  // Подмержим балансы из деньги.xlsx по нормализованному ФИО ребёнка.
  // Если файл деньги не передан — все балансы = 0.
  const moneyParsed = opts.moneyBuffer
    ? loadMoneyFile(opts.moneyBuffer)
    : { balances: new Map<string, number>(), rowsParsed: 0, duplicates: [] as { display: string; total: number; count: number }[] }
  const balances = moneyParsed.balances

  // Подсчитываем, сколько детей в Список лидов имеют одинаковое нормализованное ФИО.
  // Если на один ключ из деньги.xlsx приходится >1 ребёнка — баланс никому не зачисляем
  // (нельзя угадать, кому он принадлежит), вместо этого пишем warning. Точные суммы
  // потом проставит «Синхронизировать остатки» — она матчит по телефону, не по ФИО.
  const childOccurrences = new Map<string, number>()
  for (const r of leads) {
    const key = normName(r.child)
    childOccurrences.set(key, (childOccurrences.get(key) ?? 0) + 1)
  }

  const collectedWarnings: string[] = []
  if (moneyParsed.duplicates.length > 0) {
    const sample = moneyParsed.duplicates
      .slice(0, 10)
      .map((d) => `«${d.display}» (${d.count} строк, сумма ${d.total.toFixed(2)} ₽)`)
      .join("; ")
    collectedWarnings.push(
      `В «деньги.xlsx» строки с одинаковым ФИО — балансы просуммированы: ${sample}` +
        (moneyParsed.duplicates.length > 10 ? `; … ещё ${moneyParsed.duplicates.length - 10}` : ""),
    )
  }

  let balanceMissing = 0
  const ambiguousReported = new Set<string>()
  for (const r of leads) {
    const key = normName(r.child)
    const fromMoney = balances.get(key)
    const occurrences = childOccurrences.get(key) ?? 0
    if (fromMoney !== undefined && occurrences > 1) {
      if (!ambiguousReported.has(key)) {
        const parents = leads
          .filter((x) => normName(x.child) === key)
          .map((x) => `${x.parent || "(без имени)"} — ${x.phone || "без тел."}`)
        collectedWarnings.push(
          `Баланс ${fromMoney.toFixed(2)} ₽ для «${r.child}» НЕ зачислен: имя встречается ` +
            `у ${occurrences} разных родителей (${parents.join("; ")}). ` +
            `Уточните вручную через «Синхронизировать остатки» с телефоном в файле.`,
        )
        ambiguousReported.add(key)
      }
      if (!r.balance) balanceMissing++
      continue
    }
    if (fromMoney !== undefined) {
      r.balance = (r.balance ?? 0) + fromMoney
      // деньги.xlsx — авторитетный источник: дальше «нулевой» баланс этой
      // строки уже отличим от «нет данных».
      r.balanceFromFile = true
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

  const warnings: string[] = [...collectedWarnings]
  const withoutPhone: CreatedWithoutPhone[] = []
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
      // Авторитетный баланс приходит ТОЛЬКО если хотя бы у одной строки группы
      // balanceFromFile=true: либо в Списке лидов явно был «Баланс», либо
      // деньги.xlsx однозначно сматчился. Иначе groupBalance — это вынужденный
      // ноль из пустых ячеек, трогать им clientBalance НЕЛЬЗЯ.
      const groupHasBalanceData = group.rows.some((r) => r.balanceFromFile)
      const dbStatus = toDbStatus(top)
      const parentName = group.rows[0].parent
      const { firstName, lastName } = splitParent(parentName)
      const socialLink =
        group.rows.map((r) => r.socials).find((s) => s && s.trim()) ?? null

      const existing = group.phone ? existingByPhone.get(group.phone) : undefined

      let clientId: string
      if (existing) {
        // Объединяем: статус по приоритету между текущим и новым, имя/фамилию
        // сохраняем как было. clientBalance тут НЕ трогаем — отдельным шагом
        // через applyBalanceDelta, если в файле есть авторитетный баланс.
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
            socialLink: existing.wards.length ? undefined : socialLink ?? undefined,
          },
        })
        clientId = existing.id
        clientsMerged++
        if (groupHasBalanceData) {
          const current = new Prisma.Decimal(existing.clientBalance)
          const target = new Prisma.Decimal(groupBalance)
          const delta = target.sub(current)
          if (!delta.isZero()) {
            await applyBalanceDelta(tx, {
              tenantId: opts.tenantId,
              clientId: existing.id,
              delta,
              type: "correction",
              comment: `Импорт лидов: баланс приведён к ${target.toFixed(2)} ₽`,
              createdBy: opts.createdBy,
            })
          }
          warnings.push(
            `Объединён существующий клиент: ${parentName} (${group.phone}). ` +
              `Баланс приведён к ${groupBalance.toFixed(2)} ₽, статус → ${merged}.`,
          )
        } else {
          const existingFmt = new Prisma.Decimal(existing.clientBalance).toFixed(2)
          warnings.push(
            `Объединён существующий клиент: ${parentName} (${group.phone}). ` +
              `Баланс не менялся (${existingFmt} ₽) — в файле нет авторитетных данных по балансу. ` +
              `Статус → ${merged}.`,
          )
        }
      } else {
        // Новый клиент: создаём с дефолтным clientBalance=0, авторитетный баланс
        // (если он есть в файле) прокидываем дельтой через applyBalanceDelta —
        // чтобы в ledger появилась проводка correction.
        const created = await tx.client.create({
          data: {
            tenantId: opts.tenantId,
            firstName: firstName || null,
            lastName: lastName || null,
            phone: group.phone || null,
            socialLink: socialLink ?? null,
            funnelStatus: dbStatus.funnelStatus,
            clientStatus: dbStatus.clientStatus ?? undefined,
            // Импорт исторической базы из 1С — не «новый лид месяца»
            // (createdAt = дата импорта, а не реального обращения).
            source: "import",
            createdBy: opts.createdBy ?? undefined,
          },
          select: { id: true },
        })
        clientId = created.id
        clientsCreated++
        if (groupHasBalanceData && groupBalance !== 0) {
          await applyBalanceDelta(tx, {
            tenantId: opts.tenantId,
            clientId: created.id,
            delta: new Prisma.Decimal(groupBalance),
            type: "correction",
            comment: `Импорт лидов: начальный баланс ${groupBalance.toFixed(2)} ₽`,
            createdBy: opts.createdBy,
          })
        }
        if (!group.phone) {
          for (const r of group.rows) {
            withoutPhone.push({ rowIdx: r.rowIdx, parent: parentName, child: r.child })
          }
          warnings.push(
            `Клиент создан без телефона: ${parentName || "(без имени)"} — ` +
              `подопечный «${group.rows.map((r) => r.child).join(", ")}», ` +
              `строка${group.rows.length > 1 ? "и" : ""} файла ${group.rows.map((r) => r.rowIdx).join(", ")}.`,
          )
        }
      }
      if (groupHasBalanceData) totalBalance += groupBalance

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
        changes: {
          clientsCreated,
          clientsMerged,
          wardsCreated,
          totalBalance,
          clientsCreatedWithoutPhone: withoutPhone.length,
          withoutPhone: withoutPhone.slice(0, 200),
          warnings: warnings.slice(0, 200),
        } as unknown as Prisma.InputJsonValue,
      },
    })
  }

  return {
    ok: true,
    leadsParsed: leads.length,
    moneyParsed: moneyParsed.rowsParsed,
    clientsCreated,
    clientsMerged,
    wardsCreated,
    clientsCreatedWithoutPhone: withoutPhone.length,
    withoutPhone,
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
