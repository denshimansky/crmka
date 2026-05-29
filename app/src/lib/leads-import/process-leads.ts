// Этап 1: обработка сырой выгрузки 1С → промежуточный xlsx.
// Логика идентична import/build_leads.py.

import { readSheet, writeSheet, getCell, normPhone, normName, fmtDate } from "./parse-xlsx"
import { parentFullName } from "./surname-gender"
import { parseStatus, type LeadStatus } from "./status-map"

export interface RawLeadRow {
  fio: string
  contactPerson: string
  phone: string
  phoneNorm: string
  socials: string
  birthDate: unknown
  statusRaw: string
  status: LeadStatus | null
  // ключ группы (ФИО+телефон); если телефон пуст — уникальный.
  key: string
  // индекс исходной строки
  rowIdx: number
}

export interface Conflict {
  fio: string
  phone: string
  state: string
  reason: "child_in_lead_and_other" | "phone_has_lead_and_others"
}

export interface ProcessResult {
  ok: true
  fileBuffer: Buffer
  fileName: string
  stats: {
    totalInput: number
    afterPriority: number
    afterDedup: number
    surnameChanged: number
    needsReview: number
    byStatus: Record<LeadStatus, number>
  }
}

export interface ProcessConflicts {
  ok: false
  conflicts: Conflict[]
}

const STATE_LEAD: LeadStatus = "Лид"
const STATE_BLACKLIST: LeadStatus = "Черный список"
const STATE_ARCHIVE: LeadStatus = "Архив"
const STATE_POTENTIAL: LeadStatus = "Потенциал"
const STATE_OUT: LeadStatus = "Выбыл"

const COLUMN_FIO = ["ФИО", "Фамилия Имя"]
const COLUMN_CONTACT = ["Контактное лицо", "Контактное_лицо"]
const COLUMN_PHONE = ["Телефон", "телефон"]
const COLUMN_SOCIALS = ["Соцсети", "соцсети"]
const COLUMN_BIRTH = ["Дата рождения", "Дата_рождения"]
const COLUMN_STATUS = ["Состояние лида", "Состояние_лида", "Статус"]

function loadRawRows(buffer: Buffer): RawLeadRow[] {
  // 1С-выгрузка: пробуем разные позиции шапки. Сначала header=3 (старый формат),
  // потом 0 (если файл уже сохранён через "Сохранить как…" и шапка наверху).
  for (const headerRow of [3, 0, 1, 2]) {
    const sheet = readSheet(buffer, { headerRow })
    if (sheet.length === 0) continue
    const first = sheet[0]
    const hasFio = COLUMN_FIO.some((k) => k in first)
    const hasStatus = COLUMN_STATUS.some((k) => k in first)
    if (hasFio && hasStatus) {
      const rows: RawLeadRow[] = []
      sheet.forEach((row, idx) => {
        const fio = getCell(row, ...COLUMN_FIO)
        if (!fio) return
        const contactPerson = getCell(row, ...COLUMN_CONTACT)
        const phoneRaw = getCell(row, ...COLUMN_PHONE)
        const phone = phoneRaw
        const phoneNorm = normPhone(phoneRaw)
        const socials = getCell(row, ...COLUMN_SOCIALS)
        const birthDate = row["Дата рождения"] ?? row["Дата_рождения"] ?? null
        const statusRaw = getCell(row, ...COLUMN_STATUS)
        const status = parseStatus(statusRaw)
        const key = phoneNorm
          ? `${normName(fio)}|${phoneNorm}`
          : `__solo_${idx}`
        rows.push({ fio, contactPerson, phone, phoneNorm, socials, birthDate, statusRaw, status, key, rowIdx: idx })
      })
      return rows
    }
  }
  throw new Error("Не удалось распознать структуру файла: нужны столбцы 'ФИО' и 'Состояние лида'.")
}

function detectConflicts(rows: RawLeadRow[]): Conflict[] {
  const conflicts: Conflict[] = []
  const seen = new Set<string>()

  // (а) у одного (ФИО+Телефон) — Лид и другие статусы
  const byKey = new Map<string, RawLeadRow[]>()
  for (const r of rows) {
    const arr = byKey.get(r.key) ?? []
    arr.push(r)
    byKey.set(r.key, arr)
  }
  for (const [, group] of byKey) {
    const statuses = new Set(group.map((g) => g.status).filter((s): s is LeadStatus => !!s))
    if (statuses.has(STATE_LEAD) && [...statuses].some((s) => s !== STATE_LEAD)) {
      for (const r of group) {
        const k = `${r.rowIdx}:a`
        if (!seen.has(k)) {
          seen.add(k)
          conflicts.push({
            fio: r.fio,
            phone: r.phoneNorm,
            state: r.statusRaw,
            reason: "child_in_lead_and_other",
          })
        }
      }
    }
  }

  // (б) у одного телефона дети с Лид и не-Лид
  const byPhone = new Map<string, RawLeadRow[]>()
  for (const r of rows) {
    if (!r.phoneNorm) continue
    const arr = byPhone.get(r.phoneNorm) ?? []
    arr.push(r)
    byPhone.set(r.phoneNorm, arr)
  }
  for (const [, group] of byPhone) {
    const statuses = new Set(group.map((g) => g.status).filter((s): s is LeadStatus => !!s))
    if (statuses.has(STATE_LEAD) && [...statuses].some((s) => s !== STATE_LEAD)) {
      for (const r of group) {
        const k = `${r.rowIdx}:b`
        if (!seen.has(k)) {
          seen.add(k)
          conflicts.push({
            fio: r.fio,
            phone: r.phoneNorm,
            state: r.statusRaw,
            reason: "phone_has_lead_and_others",
          })
        }
      }
    }
  }
  return conflicts
}

function applyPriority(group: RawLeadRow[]): RawLeadRow[] {
  const states = new Set(group.map((g) => g.status).filter((s): s is LeadStatus => !!s))
  if (states.has(STATE_BLACKLIST)) return group.filter((g) => g.status === STATE_BLACKLIST)
  if (states.has(STATE_ARCHIVE)) return group.filter((g) => g.status === STATE_ARCHIVE)
  if (states.has(STATE_POTENTIAL) && states.has(STATE_OUT)) {
    return group.filter((g) => g.status === STATE_OUT)
  }
  return group
}

export function processLeads(buffer: Buffer): ProcessResult | ProcessConflicts {
  const raw = loadRawRows(buffer)
  const conflicts = detectConflicts(raw)
  if (conflicts.length > 0) {
    return { ok: false, conflicts }
  }

  // Правило 2: матрица приоритетов внутри пары ФИО+Телефон
  const byKey = new Map<string, RawLeadRow[]>()
  for (const r of raw) {
    const arr = byKey.get(r.key) ?? []
    arr.push(r)
    byKey.set(r.key, arr)
  }
  const filtered: RawLeadRow[] = []
  for (const [, group] of byKey) {
    filtered.push(...applyPriority(group))
  }

  // Дедупликация на (ФИО+Телефон)
  type OutRow = {
    "Фамилия Имя родителя": string
    "Номер_телефона": string
    "Ребёнок": string
    "Соцсети": string
    "Дата_рождения": string
    "Статус": string
    "Баланс": string
    "Проверить": string
  }
  const outRows: OutRow[] = []
  const byKey2 = new Map<string, RawLeadRow[]>()
  for (const r of filtered) {
    const arr = byKey2.get(r.key) ?? []
    arr.push(r)
    byKey2.set(r.key, arr)
  }
  const byStatus: Record<LeadStatus, number> = {
    "Лид": 0, "Потенциал": 0, "Выбыл": 0, "Архив": 0, "Черный список": 0,
  }
  let surnameChanged = 0
  let needsReviewCount = 0
  for (const [, group] of byKey2) {
    const base = group[0]
    const socials = Array.from(new Set(
      group.map((g) => g.socials).filter((s) => s && s.trim()).map((s) => s.trim())
    )).join("; ")
    const contact = group.map((g) => g.contactPerson).find((c) => c && c.trim()) ?? ""
    const dob = group.map((g) => g.birthDate).find((d) => d !== null && d !== "" && d !== undefined) ?? null
    const parent = parentFullName(base.fio, contact)
    if (parent.changed) surnameChanged++
    if (parent.needsReview) needsReviewCount++
    const status = base.status
    if (status) byStatus[status]++
    outRows.push({
      "Фамилия Имя родителя": parent.full,
      "Номер_телефона": base.phoneNorm,
      "Ребёнок": base.fio,
      "Соцсети": socials,
      "Дата_рождения": fmtDate(dob),
      "Статус": base.statusRaw,
      "Баланс": "",
      "Проверить": parent.needsReview ? "да" : "",
    })
  }

  const headers = [
    "Фамилия Имя родителя",
    "Номер_телефона",
    "Ребёнок",
    "Соцсети",
    "Дата_рождения",
    "Статус",
    "Баланс",
    "Проверить",
  ]
  const fileBuffer = writeSheet(
    outRows as unknown as Record<string, unknown>[],
    headers,
    "Лиды",
  )

  return {
    ok: true,
    fileBuffer,
    fileName: "Список лидов — для импорта.xlsx",
    stats: {
      totalInput: raw.length,
      afterPriority: filtered.length,
      afterDedup: outRows.length,
      surnameChanged,
      needsReview: needsReviewCount,
      byStatus,
    },
  }
}
