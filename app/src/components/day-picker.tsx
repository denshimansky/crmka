"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Suspense } from "react"

// Пикер одной даты для отчётов «на дату» (?date=YYYY-MM-DD). Стрелки — предыдущий/
// следующий день, нативный input открывает календарь, кнопка «Сегодня» возвращает
// на текущий день. По умолчанию (без параметра) — сегодня.

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function DayPickerInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const todayISO = toISO(new Date())
  const raw = searchParams.get("date")
  const current = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISO

  const navigate = (iso: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("date", iso)
    router.push(`${pathname}?${params.toString()}`)
  }

  const shift = (days: number) => {
    // Парсим как локальную дату (не UTC), чтобы стрелки не «прыгали» через часовой пояс.
    const [y, m, d] = current.split("-").map(Number)
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() + days)
    navigate(toISO(dt))
  }

  const isToday = current === todayISO

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="icon-xs" onClick={() => shift(-1)} aria-label="Предыдущий день">
        <ChevronLeft className="size-3.5" />
      </Button>
      <input
        type="date"
        value={current}
        onChange={(e) => e.target.value && navigate(e.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-sm [color-scheme:light] dark:[color-scheme:dark]"
        aria-label="Дата отчёта"
      />
      <Button variant="outline" size="icon-xs" onClick={() => shift(1)} aria-label="Следующий день">
        <ChevronRight className="size-3.5" />
      </Button>
      <button
        onClick={() => navigate(todayISO)}
        disabled={isToday}
        className={`whitespace-nowrap rounded-md border px-3 py-1 text-sm font-medium ${
          isToday ? "bg-primary text-primary-foreground" : "hover:bg-accent"
        }`}
      >
        Сегодня
      </button>
    </div>
  )
}

export function DayPicker() {
  return (
    <Suspense fallback={<div className="h-8 w-[240px] animate-pulse rounded-md bg-muted" />}>
      <DayPickerInner />
    </Suspense>
  )
}
