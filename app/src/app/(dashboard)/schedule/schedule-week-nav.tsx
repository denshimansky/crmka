"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

export type ScheduleView = "week" | "rooms"

const VIEW_OPTIONS: { value: ScheduleView; label: string }[] = [
  { value: "week", label: "По неделе" },
  { value: "rooms", label: "По кабинетам" },
]

interface ScheduleWeekNavProps {
  weekOffset: number
  weekLabel: string
  weekLabelCompact: string
  view: ScheduleView
}

export function ScheduleWeekNav({ weekOffset, weekLabel, weekLabelCompact, view }: ScheduleWeekNavProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const label = isMobile ? weekLabelCompact : weekLabel

  function buildUrl(offset: number, nextView: ScheduleView) {
    const params = new URLSearchParams()
    if (offset !== 0) params.set("week", String(offset))
    if (nextView !== "week") params.set("view", nextView)
    return `/schedule${params.toString() ? `?${params}` : ""}`
  }

  function navigateWeek(offset: number) {
    router.push(buildUrl(offset, view))
  }

  function navigateView(nextView: ScheduleView) {
    router.push(buildUrl(weekOffset, nextView))
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => navigateWeek(weekOffset - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="whitespace-nowrap text-sm font-medium">{label}</span>
        <Button variant="outline" size="icon" onClick={() => navigateWeek(weekOffset + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => navigateWeek(0)}>
            Сегодня
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
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
