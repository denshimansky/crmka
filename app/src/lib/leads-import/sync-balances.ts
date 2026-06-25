// Синхронизация балансов клиентов из «остатки.xlsx».
// В отличие от полного этапа 2 (sync-leads) — НЕ создаёт клиентов и НЕ
// трогает Subscription/Payment. Только обновляет Client.clientBalance через
// единственно разрешённую точку мутации applyBalanceDelta(type=correction),
// поэтому в ДДС операция не попадает.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { readSheet, normPhone } from "./parse-xlsx"

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

interface BalanceTarget {
  target: Prisma.Decimal
  contractors: string[]
  rowIdxs: number[]
}

interface ParseResult {
  byPhone: Map<string, BalanceTarget>
  rowsParsed: number
  rowsSkippedNoPhone: number
  rowsSkippedNoBalance: number
  detectedHeaders: string[]
}

export function loadBalancesFile(buffer: Buffer): ParseResult {
  const sheet = readSheet(buffer, { headerRow: 0 })
  if (sheet.length === 0) {
    return {
      byPhone: new Map(),
      rowsParsed: 0,
      rowsSkippedNoPhone: 0,
      rowsSkippedNoBalance: 0,
      detectedHeaders: [],
    }
  }
  const headers = Object.keys(sheet[0])
  const normMap = new Map<string, string>()
  for (const h of headers) normMap.set(normColKey(h), h)

  const byPhone = new Map<string, BalanceTarget>()
  let rowsParsed = 0
  let rowsSkippedNoPhone = 0
  let rowsSkippedNoBalance = 0

  sheet.forEach((row, idx) => {
    const phoneRaw = pickValue(row, normMap, "Телефон", "Номер_телефона", "Номер телефона")
    const phoneStr = phoneRaw === null ? "" : String(phoneRaw).trim()
    // Строка «Итого» — служебная, в файле остатки.xlsx стоит в колонке «Телефон».
    if (phoneStr.toLowerCase() === "итого") return
    const phone = normPhone(phoneStr)
    if (!phone) {
      rowsSkippedNoPhone++
      return
    }
    const balRaw = pickValue(row, normMap, "Баланс на сегодня", "Баланс")
    if (balRaw === null || balRaw === undefined || balRaw === "") {
      rowsSkippedNoBalance++
      return
    }
    const balNum = Number(balRaw)
    if (!Number.isFinite(balNum)) {
      rowsSkippedNoBalance++
      return
    }

    const contractor = String(
      pickValue(row, normMap, "Контрагент", "ФИО", "Ребёнок", "Ребенок") ?? "",
    ).trim()

    const bucket = byPhone.get(phone) ?? {
      target: new Prisma.Decimal(0),
      contractors: [],
      rowIdxs: [],
    }
    bucket.target = bucket.target.add(new Prisma.Decimal(balNum))
    if (contractor) bucket.contractors.push(contractor)
    bucket.rowIdxs.push(idx + 2) // +1 за заголовок, +1 для 1-based
    byPhone.set(phone, bucket)
    rowsParsed++
  })

  return {
    byPhone,
    rowsParsed,
    rowsSkippedNoPhone,
    rowsSkippedNoBalance,
    detectedHeaders: headers,
  }
}

export interface SyncBalancesOptions {
  buffer: Buffer
  tenantId: string
  createdBy: string | null
}

export interface MissingClient {
  phone: string
  contractor: string
  target: number
}

export interface UpdatedClient {
  phone: string
  clientId: string
  fullName: string
  oldBalance: number
  newBalance: number
  delta: number
}

export interface SyncBalancesEmpty {
  ok: false
  reason: "empty_file"
  detectedHeaders: string[]
}

export interface SyncBalancesReport {
  ok: true
  rowsParsed: number
  rowsSkippedNoPhone: number
  rowsSkippedNoBalance: number
  phonesTotal: number
  matched: number
  updated: number
  unchanged: number
  missingInDb: MissingClient[]
  updatedClients: UpdatedClient[]
  totalTargetSum: number
  totalDeltaApplied: number
}

export async function syncBalances(
  opts: SyncBalancesOptions,
): Promise<SyncBalancesReport | SyncBalancesEmpty> {
  const parsed = loadBalancesFile(opts.buffer)
  if (parsed.byPhone.size === 0) {
    return { ok: false, reason: "empty_file", detectedHeaders: parsed.detectedHeaders }
  }

  const phones = [...parsed.byPhone.keys()]
  const existingClients = await db.client.findMany({
    where: { tenantId: opts.tenantId, deletedAt: null, phone: { in: phones } },
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      clientBalance: true,
    },
  })
  const existingByPhone = new Map(existingClients.map((c) => [c.phone ?? "", c]))

  const missingInDb: MissingClient[] = []
  const updatedClients: UpdatedClient[] = []
  let matched = 0
  let updated = 0
  let unchanged = 0
  let totalTargetSum = new Prisma.Decimal(0)
  let totalDeltaApplied = new Prisma.Decimal(0)

  await db.$transaction(async (tx) => {
    for (const [phone, bucket] of parsed.byPhone) {
      totalTargetSum = totalTargetSum.add(bucket.target)
      const existing = existingByPhone.get(phone)
      if (!existing) {
        missingInDb.push({
          phone,
          contractor: bucket.contractors[0] ?? "",
          target: bucket.target.toNumber(),
        })
        continue
      }
      matched++
      const current = new Prisma.Decimal(existing.clientBalance)
      const delta = bucket.target.sub(current)
      if (delta.isZero()) {
        unchanged++
        continue
      }
      const { newBalance } = await applyBalanceDelta(tx, {
        tenantId: opts.tenantId,
        clientId: existing.id,
        delta,
        type: "correction",
        comment: "Импорт остатков из 1С (остатки.xlsx)",
        createdBy: opts.createdBy,
      })
      updated++
      totalDeltaApplied = totalDeltaApplied.add(delta)
      updatedClients.push({
        phone,
        clientId: existing.id,
        fullName: [existing.lastName, existing.firstName].filter(Boolean).join(" ").trim(),
        oldBalance: current.toNumber(),
        newBalance: new Prisma.Decimal(newBalance).toNumber(),
        delta: delta.toNumber(),
      })
    }
  }, {
    // Импорт остатков большой базы: дефолтный таймаут интерактивной транзакции
    // Prisma (5 с) недостаточен на тысячах построчных корректировок баланса.
    maxWait: 20_000,
    timeout: 120_000,
  })

  if (opts.createdBy) {
    await db.auditLog.create({
      data: {
        tenantId: opts.tenantId,
        employeeId: opts.createdBy,
        action: "balances_import_sync",
        entityType: "system",
        entityId: opts.tenantId,
        changes: {
          updated,
          unchanged,
          missingCount: missingInDb.length,
          totalTargetSum: totalTargetSum.toNumber(),
          totalDeltaApplied: totalDeltaApplied.toNumber(),
        },
      },
    })
  }

  return {
    ok: true,
    rowsParsed: parsed.rowsParsed,
    rowsSkippedNoPhone: parsed.rowsSkippedNoPhone,
    rowsSkippedNoBalance: parsed.rowsSkippedNoBalance,
    phonesTotal: parsed.byPhone.size,
    matched,
    updated,
    unchanged,
    missingInDb,
    updatedClients,
    totalTargetSum: totalTargetSum.toNumber(),
    totalDeltaApplied: totalDeltaApplied.toNumber(),
  }
}
