"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

export type ScheduleView = "week" | "rooms" | "month"

const WEEK_VIEW_OPTIONS: { value: Extract<ScheduleView, "week" | "rooms">; label: string }[] = [
  { value: "week", label: "По неделе" },
  { value: "rooms", label: "По кабинетам" },
]

type Period = "week" | "month"

interface ScheduleWeekNavProps {
  weekOffset: number
  weekLabel: string
  weekLabelCompact: string
  monthOffset: number
  monthLabel: string
  monthLabelCompact: string
  view: ScheduleView
}

export function ScheduleWeekNav({
  weekOffset,
  weekLabel,
  weekLabelCompact,
  monthOffset,
  monthLabel,
  monthLabelCompact,
  view,
}: ScheduleWeekNavProps) {
  const router = useRouter()
  const isMobile = useIsMobile()

  const period: Period = view === "month" ? "month" : "week"
  const label = isMobile
    ? period === "month"
      ? monthLabelCompact
      : weekLabelCompact
    : period === "month"
      ? monthLabel
      : weekLabel

  function buildUrl(opts: { view: ScheduleView; weekOffset: number; monthOffset: number }) {
    const params = new URLSearchParams()
    if (opts.view !== "week") params.set("view", opts.view)
    if (opts.view === "month") {
      if (opts.monthOffset !== 0) params.set("monthOffset", String(opts.monthOffset))
    } else {
      if (opts.weekOffset !== 0) params.set("week", String(opts.weekOffset))
    }
    return `/schedule${params.toString() ? `?${params}` : ""}`
  }

  function navigatePrev() {
    if (period === "month") {
      router.push(buildUrl({ view, weekOffset, monthOffset: monthOffset - 1 }))
    } else {
      router.push(buildUrl({ view, weekOffset: weekOffset - 1, monthOffset }))
    }
  }

  function navigateNext() {
    if (period === "month") {
      router.push(buildUrl({ view, weekOffset, monthOffset: monthOffset + 1 }))
    } else {
      router.push(buildUrl({ view, weekOffset: weekOffset + 1, monthOffset }))
    }
  }

  function goToToday() {
    if (period === "month") {
      router.push(buildUrl({ view, weekOffset, monthOffset: 0 }))
    } else {
      router.push(buildUrl({ view, weekOffset: 0, monthOffset }))
    }
  }

  function setPeriod(next: Period) {
    if (next === period) return
    if (next === "month") {
      router.push(buildUrl({ view: "month", weekOffset, monthOffset }))
    } else {
      // При возврате из «Месяц» — встаём на «По неделе» как умолчательный вариант
      // (пользователь может вручную переключить sub-view ниже).
      router.push(buildUrl({ view: "week", weekOffset, monthOffset }))
    }
  }

  function setWeekSubView(next: Extract<ScheduleView, "week" | "rooms">) {
    router.push(buildUrl({ view: next, weekOffset, monthOffset }))
  }

  const isAtCurrentPeriod = period === "month" ? monthOffset === 0 : weekOffset === 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={navigatePrev}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="whitespace-nowrap text-sm font-medium">{label}</span>
        <Button variant="outline" size="icon" onClick={navigateNext}>
          <ChevronRight className="size-4" />
        </Button>
        {!isAtCurrentPeriod && (
          <Button variant="ghost" size="sm" onClick={goToToday}>
            Сегодня
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Период: Неделя / Месяц */}
        <div className="flex gap-1">
          <Button
            variant={period === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod("week")}
          >
            Неделя
          </Button>
          <Button
            variant={period === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod("month")}
          >
            Месяц
          </Button>
        </div>

        {/* Подвид недели — только в режиме «Неделя» */}
        {period === "week" && (
          <div className="flex flex-wrap gap-1">
            {WEEK_VIEW_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={opt.value === view ? "default" : "outline"}
                size="sm"
                onClick={() => setWeekSubView(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
