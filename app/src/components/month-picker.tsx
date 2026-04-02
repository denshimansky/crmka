"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Suspense } from "react"

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function MonthPickerInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const now = new Date()
  const year = Number(searchParams.get("year")) || now.getFullYear()
  const month = Number(searchParams.get("month")) || now.getMonth() + 1

  const navigate = (newYear: number, newMonth: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("year", String(newYear))
    params.set("month", String(newMonth))
    router.push(`${pathname}?${params.toString()}`)
  }

  const prev = () => {
    if (month === 1) navigate(year - 1, 12)
    else navigate(year, month - 1)
  }

  const next = () => {
    if (month === 12) navigate(year + 1, 1)
    else navigate(year, month + 1)
  }

  const goToday = () => {
    navigate(now.getFullYear(), now.getMonth() + 1)
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" onClick={prev}>
        <ChevronLeft className="size-4" />
      </Button>
      <button
        onClick={goToday}
        className={`min-w-[160px] rounded-md border px-3 py-1 text-sm font-medium ${
          isCurrentMonth ? "bg-primary text-primary-foreground" : "hover:bg-accent"
        }`}
      >
        {MONTH_NAMES[month]} {year}
      </button>
      <Button variant="outline" size="icon-sm" onClick={next}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

export function MonthPicker() {
  return (
    <Suspense fallback={<div className="h-8 w-[200px] animate-pulse rounded-md bg-muted" />}>
      <MonthPickerInner />
    </Suspense>
  )
}

// getMonthFromParams вынесен в @/lib/month-params (для server components)
