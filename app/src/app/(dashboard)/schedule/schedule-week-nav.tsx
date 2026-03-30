"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface ScheduleWeekNavProps {
  weekOffset: number
  weekLabel: string
}

export function ScheduleWeekNav({ weekOffset, weekLabel }: ScheduleWeekNavProps) {
  const router = useRouter()

  function navigate(offset: number) {
    const params = new URLSearchParams()
    if (offset !== 0) params.set("week", String(offset))
    router.push(`/schedule${params.toString() ? `?${params}` : ""}`)
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => navigate(weekOffset - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <Button variant="outline" size="icon" onClick={() => navigate(weekOffset + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => navigate(0)}>
            Сегодня
          </Button>
        )}
      </div>
      <div className="flex gap-1">
        {["По кабинетам", "По педагогам", "По направлениям", "Список"].map((v, i) => (
          <Button key={v} variant={i === 0 ? "default" : "outline"} size="sm">
            {v}
          </Button>
        ))}
      </div>
    </div>
  )
}
