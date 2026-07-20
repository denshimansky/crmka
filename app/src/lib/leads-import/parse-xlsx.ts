import * as XLSX from "xlsx"

export interface SheetReadOptions {
  // Индекс строки с заголовками (0-based). В выгрузке 1С шапка на 4-й строке (index 3).
  headerRow?: number
}

export function readSheet(buffer: Buffer, opts: SheetReadOptions = {}): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  const headerRow = opts.headerRow ?? 0
  // sheet_to_json с range = строка заголовков.
  return XLSX.utils.sheet_to_json(ws, { defval: null, range: headerRow }) as Record<string, unknown>[]
}

export function writeSheet(rows: Record<string, unknown>[], headers: string[], sheetName: string): Buffer {
  const wb = XLSX.utils.book_new()
  // Создаём массив-массивов: первая строка — заголовки, потом данные.
  const aoa: unknown[][] = [headers]
  for (const r of rows) {
    aoa.push(headers.map((h) => r[h] ?? ""))
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Ширины колонок (примерно)
  const widths: Record<string, number> = {
    "Фамилия Имя родителя": 32,
    "Номер_телефона": 18,
    "Ребёнок": 32,
    "Соцсети": 40,
    "Дата_рождения": 16,
    "Статус": 18,
    "Филиал": 16,
    "Баланс": 14,
    "Проверить": 12,
  }
  ws["!cols"] = headers.map((h) => ({ wch: widths[h] ?? 18 }))
  // Заморозка шапки
  ws["!freeze"] = { xSplit: 0, ySplit: 1 } as unknown as Record<string, number>
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  return out
}

export function getCell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v === null || v === undefined) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ""
}

// Нормализация ключа колонки для регистронезависимого сопоставления заголовков:
// lower-case, ё→е, _→пробел, схлопывание пробелов. 1С выдаёт название одной и
// той же колонки в разном регистре («Статус» / «статус» / «Актив»), поэтому
// сравниваем по нормализованному ключу, а не по точному совпадению.
export function normColKey(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/_/g, " ").replace(/\s+/g, " ")
}

// Карта: нормализованный ключ колонки → реальное название в строке.
export function buildColMap(row: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>()
  for (const k of Object.keys(row)) {
    const norm = normColKey(k)
    // Первое вхождение выигрывает (у дубликатов заголовков берём левую колонку).
    if (!map.has(norm)) map.set(norm, k)
  }
  return map
}

// Значение ячейки по любому из алиасов через нормализованную карту колонок.
// Возвращает первую непустую строку (trim), иначе "".
export function getCellByMap(
  row: Record<string, unknown>,
  colMap: Map<string, string>,
  ...aliases: string[]
): string {
  for (const alias of aliases) {
    const realKey = colMap.get(normColKey(alias))
    if (realKey === undefined) continue
    const v = row[realKey]
    if (v === null || v === undefined) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ""
}

export function normPhone(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ""
  return String(raw).replace(/\D/g, "")
}

export function normName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ""
  return String(raw).trim().toLowerCase().replace(/\s+/g, " ")
}

export function fmtDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return ""
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = String(v.getDate()).padStart(2, "0")
    const m = String(v.getMonth() + 1).padStart(2, "0")
    const y = v.getFullYear()
    return `${d}.${m}.${String(y).slice(-2)}`
  }
  return String(v).trim()
}
