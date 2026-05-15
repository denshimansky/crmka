"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type ScheduleView = "rooms" | "instructors" | "directions" | "list"

const VIEW_OPTIONS: { value: ScheduleView; label: string }[] = [
  { value: "rooms", label: "По кабинетам" },
  { value: "instructors", label: "По педагогам" },
  { value: "directions", label: "По направлениям" },
  { value: "list", label: "Список" },
]

interface ScheduleWeekNavProps {
  weekOffset: number
  weekLabel: string
  view: ScheduleView
}

export function ScheduleWeekNav({ weekOffset, weekLabel, view }: ScheduleWeekNavProps) {
  const router = useRouter()

  function buildUrl(offset: number, nextView: ScheduleView) {
    const params = new URLSearchParams()
    if (offset !== 0) params.set("week", String(offset))
    if (nextView !== "rooms") params.set("view", nextView)
    return `/schedule${params.toString() ? `?${params}` : ""}`
  }

  function navigateWeek(offset: number) {
    router.push(buildUrl(offset, view))
  }

  function navigateView(nextView: ScheduleView) {
    router.push(buildUrl(weekOffset, nextView))
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => navigateWeek(weekOffset - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <Button variant="outline" size="icon" onClick={() => navigateWeek(weekOffset + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => navigateWeek(0)}>
            Сегодня
          </Button>
        )}
      </div>
      <div className="flex gap-1">
        {VIEW_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={opt.value === view ? "default" : "outline"}
            size="sm"
            onClick={() => navigateView(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
