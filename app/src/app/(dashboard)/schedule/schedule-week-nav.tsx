"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

export type ScheduleView = "week" | "month"

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
      </div>
    </div>
  )
}
