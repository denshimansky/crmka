/**
 * Общие утилиты месячной сетки.
 *
 * Понедельник считается стартом недели. Используется в production-calendar
 * (с null-хвостами) и в schedule month view (без null, но с флагом
 * `inCurrentMonth` для дней соседних месяцев).
 */

/** Локальная дата → YYYY-MM-DD без таймзоновых сюрпризов. */
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Сетка дней месяца с пустыми «хвостами» (null) до полной недели.
 * Длина массива всегда кратна 7.
 */
export function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startWeekDay = first.getDay() === 0 ? 7 : first.getDay()
  const cells: (Date | null)[] = []
  for (let i = 1; i < startWeekDay; i++) cells.push(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/**
 * Полная сетка месяца с захватом хвостов соседних месяцев — все ячейки
 * имеют реальную дату, а флаг inCurrentMonth говорит, относится ли дата
 * к выбранному месяцу или к соседнему.
 */
export function buildMonthGridFull(
  year: number,
  month: number
): { date: Date; inCurrentMonth: boolean }[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startWeekDay = first.getDay() === 0 ? 7 : first.getDay()
  const gridStart = new Date(year, month, 1 - (startWeekDay - 1))
  const cells: { date: Date; inCurrentMonth: boolean }[] = []
  const cursor = new Date(gridStart)
  // продолжаем, пока не вышли за конец месяца и не закрыли неделю до воскресенья
  while (
    cursor <= last ||
    cursor.getDay() !== 1 // 1 — понедельник; то есть пока не вернулись к пн следующей недели
  ) {
    cells.push({
      date: new Date(cursor),
      inCurrentMonth: cursor.getMonth() === month,
    })
    cursor.setDate(cursor.getDate() + 1)
    if (cells.length >= 42) break // защита от бесконечного цикла
  }
  return cells
}

/** Границы сетки месяца для server-side запроса диапазона. */
export function getMonthGridRange(
  year: number,
  month: number
): { gridStart: Date; gridEnd: Date; monthStart: Date; monthEnd: Date } {
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0)
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
  const startWeekDay = monthStart.getDay() === 0 ? 7 : monthStart.getDay()
  const gridStart = new Date(year, month, 1 - (startWeekDay - 1), 0, 0, 0, 0)
  const grid = buildMonthGridFull(year, month)
  const lastCell = grid[grid.length - 1].date
  const gridEnd = new Date(
    lastCell.getFullYear(),
    lastCell.getMonth(),
    lastCell.getDate(),
    23,
    59,
    59,
    999
  )
  return { gridStart, gridEnd, monthStart, monthEnd }
}

/** {year, month} с заданным offset месяцев от текущего. */
export function offsetMonth(offset: number): { year: number; month: number } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}
