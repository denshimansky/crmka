"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

// Простой month-grid календарь. Если задан availableDates — только эти даты
// кликабельны, остальные приглушены. Используется для выбора даты пробного
// в рамках сгенерированных занятий группы.

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseIso(iso: string): Date {
  // Используем локальное время, чтобы не плыть по тайм-зонам.
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export interface CalendarProps {
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
  /** Если задано — кликабельны только эти даты, остальные disabled. */
  availableDates?: Set<string>
  /** Полностью отключить все ячейки. */
  disabled?: boolean
  className?: string
  /** Текст под календарём при пустом availableDates. */
  emptyHint?: string
  /**
   * Показывать выпадающие списки месяца и года вместо статичной подписи —
   * быстрый прыжок для дальних дат (дата рождения). По умолчанию выключено,
   * чтобы пикер даты пробного/занятия (навигация стрелками) не менялся.
   */
  monthYearNav?: boolean
  /** Диапазон лет для monthYearNav (по умолчанию текущий−100 … текущий+1). */
  fromYear?: number
  toYear?: number
}

export function Calendar({
  value,
  onChange,
  availableDates,
  disabled,
  className,
  emptyHint,
  monthYearNav,
  fromYear,
  toYear,
}: CalendarProps) {
  const initial = value ? parseIso(value) : new Date()
  const [viewYear, setViewYear] = React.useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = React.useState(initial.getMonth())

  // Если value поменялось снаружи и выходит за пределы текущего просмотра — переключим месяц.
  React.useEffect(() => {
    if (!value) return
    const d = parseIso(value)
    if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth) {
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  const startWeekday = (firstDay.getDay() + 6) % 7 // Понедельник = 0
  const today = isoDate(new Date())

  const cells: { date: Date; iso: string }[] = []
  for (let i = startWeekday; i > 0; i--) {
    cells.push({ date: new Date(viewYear, viewMonth, 1 - i), iso: "" })
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const d = new Date(viewYear, viewMonth, i)
    cells.push({ date: d, iso: isoDate(d) })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    const next = new Date(last)
    next.setDate(last.getDate() + 1)
    cells.push({ date: next, iso: "" })
  }
  // финальная нормализация iso
  for (const c of cells) if (!c.iso) c.iso = isoDate(c.date)

  function prev() {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }
  function next() {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const hasAvailableFilter = !!availableDates
  const noneAvailable = hasAvailableFilter && availableDates!.size === 0

  const curY = new Date().getFullYear()
  const yFrom = fromYear ?? curY - 100
  const yTo = toYear ?? curY + 1
  const years: number[] = []
  if (monthYearNav) for (let y = yTo; y >= yFrom; y--) years.push(y)

  return (
    <div className={cn("rounded-md border bg-card p-2", className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={prev}>
          <ChevronLeftIcon />
        </Button>
        {monthYearNav ? (
          <div className="flex items-center gap-1">
            <Select
              value={String(viewMonth)}
              onValueChange={(v) => v && setViewMonth(Number(v))}
            >
              <SelectTrigger className="h-7 gap-1 px-2 text-sm font-medium">
                {MONTHS[viewMonth]}
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(viewYear)}
              onValueChange={(v) => v && setViewYear(Number(v))}
            >
              <SelectTrigger className="h-7 gap-1 px-2 text-sm font-medium">
                {viewYear}
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="text-sm font-medium">
            {MONTHS[viewMonth]} {viewYear}
          </div>
        )}
        <Button type="button" variant="ghost" size="icon-sm" onClick={next}>
          <ChevronRightIcon />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ date, iso }, i) => {
          const isCurMonth = date.getMonth() === viewMonth
          const isAvailable = !hasAvailableFilter || availableDates!.has(iso)
          const isSelected = iso === value
          const isToday = iso === today
          const cellDisabled = disabled || !isAvailable
          return (
            <button
              key={`${iso}-${i}`}
              type="button"
              disabled={cellDisabled}
              onClick={() => !cellDisabled && onChange(iso)}
              className={cn(
                "relative h-8 rounded text-xs transition-colors",
                isCurMonth ? "text-foreground" : "text-muted-foreground/40",
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : // Зелёная подсветка «доступной» даты — только когда задан фильтр
                    // availableDates (пикер даты пробного/занятия). Без фильтра (напр.
                    // дата рождения) кликабельны все дни — обычный нейтральный вид.
                    hasAvailableFilter && isAvailable && isCurMonth
                    ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    : "hover:bg-accent",
                cellDisabled && !isSelected && "cursor-not-allowed opacity-50 hover:bg-transparent",
                isToday && !isSelected && "ring-1 ring-primary/40 ring-inset",
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>

      {noneAvailable && emptyHint && (
        <p className="mt-2 text-xs text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  )
}
