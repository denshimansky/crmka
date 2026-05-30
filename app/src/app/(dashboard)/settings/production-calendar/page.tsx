"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ArrowLeft,
  Trash2,
} from "lucide-react"

interface CalendarItem {
  id: string
  date: string // ISO
  isWorking: boolean
  comment: string | null
}

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  // Понедельник как начало недели: 1..7
  const startWeekDay = first.getDay() === 0 ? 7 : first.getDay()
  const cells: (Date | null)[] = []
  for (let i = 1; i < startWeekDay; i++) cells.push(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function ProductionCalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0..11

  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editIsWorking, setEditIsWorking] = useState(false)
  const [editComment, setEditComment] = useState("")
  const [saving, setSaving] = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/production-calendar?year=${year}&month=${month + 1}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка загрузки")
        return
      }
      setItems(await res.json())
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const itemByDate = useMemo(() => {
    const map = new Map<string, CalendarItem>()
    for (const i of items) {
      map.set(i.date.slice(0, 10), i)
    }
    return map
  }, [items])

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  function goPrev() {
    if (month === 0) {
      setMonth(11)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
  }
  function goNext() {
    if (month === 11) {
      setMonth(0)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
  }
  function goToday() {
    const t = new Date()
    setYear(t.getFullYear())
    setMonth(t.getMonth())
  }

  function openDay(date: Date) {
    const key = ymd(date)
    const existing = itemByDate.get(key)
    setSelectedDate(key)
    setEditIsWorking(existing ? existing.isWorking : false)
    setEditComment(existing?.comment || "")
    setError(null)
  }

  async function saveDay() {
    if (!selectedDate) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/production-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          isWorking: editIsWorking,
          comment: editComment.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка сохранения")
        return
      }
      setSelectedDate(null)
      await loadItems()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function deleteDay() {
    if (!selectedDate) return
    const item = itemByDate.get(selectedDate)
    if (!item) {
      setSelectedDate(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/production-calendar/${item.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка удаления")
        return
      }
      setSelectedDate(null)
      await loadItems()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  const todayKey = ymd(new Date())

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 size-4" />
          Назад к настройкам
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <CalendarDays className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">Производственный календарь</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Праздничные и нерабочие дни. Занятия в эти дни автоматически пропускаются при генерации
          и копировании расписания.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={goPrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">
                {MONTH_NAMES[month]} {year}
              </h2>
              <Button variant="ghost" size="sm" onClick={goToday}>
                Сегодня
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={goNext}>
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {error && !selectedDate && (
            <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_NAMES.map((n) => (
              <div
                key={n}
                className="py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {n}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />
              const key = ymd(d)
              const item = itemByDate.get(key)
              const isToday = key === todayKey
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isNonWorking = item && !item.isWorking
              const isExplicitWorking = item && item.isWorking

              let style = "hover:bg-muted/40"
              if (isNonWorking) {
                style = "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200"
              } else if (isExplicitWorking) {
                style = "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-200"
              } else if (isWeekend) {
                style = "text-muted-foreground hover:bg-muted/40"
              }

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => openDay(d)}
                  className={`flex min-h-[40px] flex-col items-center justify-center rounded-md border px-1 py-1 text-xs transition-colors ${style} ${
                    isToday ? "ring-2 ring-primary" : ""
                  }`}
                  title={item?.comment || ""}
                >
                  <span className="font-medium leading-none">{d.getDate()}</span>
                  {item?.comment && (
                    <span className="mt-0.5 max-w-full truncate text-[9px] leading-none opacity-80">
                      {item.comment}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-sm bg-red-200 dark:bg-red-900/40" />
              Праздник / выходной
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-sm bg-green-200 dark:bg-green-900/40" />
              Перенесённый рабочий день
            </span>
            <span>{loading && "Загрузка..."}</span>
          </div>
        </CardContent>
      </Card>

      {/* Диалог редактирования дня */}
      <Dialog
        open={!!selectedDate}
        onOpenChange={(o) => {
          if (!o) setSelectedDate(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedDate
                ? new Date(selectedDate).toLocaleDateString("ru-RU", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })
                : "Дата"}
            </DialogTitle>
            <DialogDescription>
              Отметьте день как праздник/выходной или перенесённый рабочий день.
              Занятия в нерабочие дни не будут создаваться при генерации.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditIsWorking(false)}
                className={`rounded-md border p-3 text-sm transition-colors ${
                  !editIsWorking
                    ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                    : "hover:bg-muted/40"
                }`}
              >
                <div className="font-medium">Нерабочий</div>
                <div className="text-xs text-muted-foreground">Праздник или выходной</div>
              </button>
              <button
                type="button"
                onClick={() => setEditIsWorking(true)}
                className={`rounded-md border p-3 text-sm transition-colors ${
                  editIsWorking
                    ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                    : "hover:bg-muted/40"
                }`}
              >
                <div className="font-medium">Рабочий</div>
                <div className="text-xs text-muted-foreground">Например, перенос с субботы</div>
              </button>
            </div>

            <div>
              <Label htmlFor="comment">Комментарий</Label>
              <Input
                id="comment"
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                placeholder="Например: Новый год, перенос с 6 ноября"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <div>
              {selectedDate && itemByDate.has(selectedDate) && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={deleteDay}
                  disabled={saving}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-1 size-4" />
                  Очистить
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" type="button" />}>
                Отмена
              </DialogClose>
              <Button type="button" onClick={saveDay} disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
