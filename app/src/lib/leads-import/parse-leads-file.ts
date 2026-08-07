// Этап 2 импорта, чистая часть (без БД): разбор заполненного шаблона «Клиенты»
// в строки + схлопывание дублей и разбор даты рождения. Вынесено из sync-leads.ts,
// чтобы юнит-тесты гоняли эту логику без импорта Prisma/@/lib/db.

import { readSheet, normPhone, normName } from "./parse-xlsx"
import { parseStatus, topStatus, type LeadStatus } from "./status-map"

export interface LeadFileRow {
  parent: string
  phone: string
  child: string
  socials: string
  // Сырое значение ячейки «Дата_рождения»: строка «DD.MM.YY» из выгрузки 1С
  // ЛИБО JS Date, если дату вбили в Excel типизированной ячейкой. parseDob
  // понимает оба варианта.
  birthDate: unknown
  status: LeadStatus | null
  branch: string
  balance: number
  /** true, если значение баланса пришло из явной ячейки файла («Баланс» в
   *  Списке лидов или матч в деньги.xlsx). false — это «нет данных», и
   *  трогать существующий clientBalance в БД нельзя. */
  balanceFromFile: boolean
  needsReview: boolean
  rowIdx: number
}

// Нормализация ключа колонки: lower-case, ё→е, _→пробел, схлопывание пробелов.
export function normColKey(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/_/g, " ").replace(/\s+/g, " ")
}

export function pickValue(
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

export function loadLeadsFile(buffer: Buffer): { rows: LeadFileRow[]; headers: string[] } {
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
    // НЕ приводим к строке: типизированную дату Excel xlsx отдаёт как JS Date,
    // а String(Date) даёт «Fri Nov 30 2018…», который parseDob не понимает —
    // дата рождения терялась. Храним сырое значение, parseDob разбирает и Date, и строку.
    const birthDate = pickValue(row, normMap, "Дата_рождения", "Дата рождения")
    const status = parseStatus(String(pickValue(row, normMap, "Статус", "Состояние лида") ?? ""))
    const branch = String(pickValue(row, normMap, "Филиал", "Подразделение", "Точка") ?? "").trim()
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
      branch,
      balance: Number.isFinite(balance) ? balance : 0,
      balanceFromFile: balanceHasValue && Number.isFinite(balance),
      needsReview: review === "да" || review === "yes" || review === "true",
      rowIdx: idx + 2, // +1 за заголовок, +1 для 1-based
    })
  })
  return { rows: out, headers }
}

// Схлопывание дубликатов «один ребёнок в нескольких строках» внутри загружаемого
// файла — та же логика, что на этапе 1 (processLeads), но применённая к уже
// разобранным строкам шаблона. Сырая выгрузка 1С даёт по строке на каждое
// направление/абонемент, поэтому один ребёнок у одного телефона встречается
// многократно (в базе ДЦ Знамникус — до 10 строк на «шапкин илья»). Раньше этап 2
// создавал по подопечному на каждую строку → 10 одинаковых детей у родителя.
// Ключ дедупа = телефон + имя ребёнка. Строки без телефона не схлопываем (их и так
// нельзя надёжно сматчить — каждая остаётся отдельной, как и прежде).
export function dedupLeadRows(rows: LeadFileRow[]): {
  rows: LeadFileRow[]
  collapsed: number
} {
  const out: LeadFileRow[] = []
  const byKey = new Map<string, LeadFileRow>()
  let collapsed = 0
  for (const r of rows) {
    if (!r.phone) {
      out.push(r)
      continue
    }
    const key = `${r.phone}|${normName(r.child)}`
    const base = byKey.get(key)
    if (!base) {
      const copy = { ...r }
      byKey.set(key, copy)
      out.push(copy)
      continue
    }
    collapsed++
    // Родитель/филиал/дата/соцсети — первый непустой; статус — приоритетный;
    // баланс — первый авторитетный. Баланс НЕ суммируем: у дублей одного ребёнка
    // это один и тот же баланс родителя, суммирование умножило бы его на число строк.
    if (!base.parent && r.parent) base.parent = r.parent
    if (!base.branch && r.branch) base.branch = r.branch
    if (dobEmpty(base.birthDate) && !dobEmpty(r.birthDate)) base.birthDate = r.birthDate
    base.socials = mergeSocials(base.socials, r.socials)
    base.status =
      topStatus([base.status, r.status].filter((s): s is LeadStatus => !!s)) ?? base.status
    if (!base.balanceFromFile && r.balanceFromFile) {
      base.balance = r.balance
      base.balanceFromFile = true
    }
    if (r.needsReview) base.needsReview = true
  }
  return { rows: out, collapsed }
}

function dobEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === ""
}

function mergeSocials(a: string, b: string): string {
  const parts = [a, b]
    .flatMap((s) => (s ?? "").split(";"))
    .map((s) => s.trim())
    .filter(Boolean)
  return Array.from(new Set(parts)).join("; ")
}

export function parseDob(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null
  // Типизированная ячейка Excel: xlsx (cellDates) отдаёт JS Date в ЛОКАЛЬНОМ
  // времени (напр. 30.11.2018 00:00 MSK = 2018-11-29T21:00Z). Берём локальные
  // Y/M/D — именно тот день, что видел пользователь, — и пересобираем как
  // UTC-полночь. Через toISOString() дата уехала бы на день назад.
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    const d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()))
    return isNaN(d.getTime()) ? null : d
  }
  const s = String(raw).trim()
  if (!s) return null
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
