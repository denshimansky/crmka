"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Suspense } from "react"

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

interface MonthPickerProps {
  /** Запрет листать в прошлое: «назад» заблокирована на текущем месяце и раньше. */
  disablePast?: boolean
  /** Максимум месяцев вперёд от текущего; «вперёд» блокируется на пределе. */
  maxMonthsAhead?: number
}

function MonthPickerInner({ disablePast, maxMonthsAhead }: MonthPickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const now = new Date()
  const year = Number(searchParams.get("year")) || now.getFullYear()
  const month = Number(searchParams.get("month")) || now.getMonth() + 1

  // Ключи месяца (year*12 + monthIndex) для сравнения границ.
  const currentKey = now.getFullYear() * 12 + now.getMonth()
  const viewedKey = year * 12 + (month - 1)
  const prevDisabled = !!disablePast && viewedKey <= currentKey
  const nextDisabled = maxMonthsAhead != null && viewedKey >= currentKey + maxMonthsAhead

  const navigate = (newYear: number, newMonth: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("year", String(newYear))
    params.set("month", String(newMonth))
    router.push(`${pathname}?${params.toString()}`)
  }

  const prev = () => {
    if (prevDisabled) return
    if (month === 1) navigate(year - 1, 12)
    else navigate(year, month - 1)
  }

  const next = () => {
    if (nextDisabled) return
    if (month === 12) navigate(year + 1, 1)
    else navigate(year, month + 1)
  }

  const goToday = () => {
    navigate(now.getFullYear(), now.getMonth() + 1)
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="icon-xs" onClick={prev} disabled={prevDisabled}>
        <ChevronLeft className="size-3.5" />
      </Button>
      <button
        onClick={goToday}
        className={`min-w-[128px] whitespace-nowrap rounded-md border px-3 py-1 text-center text-sm font-medium sm:min-w-[160px] ${
          isCurrentMonth ? "bg-primary text-primary-foreground" : "hover:bg-accent"
        }`}
      >
        {MONTH_NAMES[month]} {year}
      </button>
      <Button variant="outline" size="icon-xs" onClick={next} disabled={nextDisabled}>
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

export function MonthPicker(props: MonthPickerProps = {}) {
  return (
    <Suspense fallback={<div className="h-8 w-[200px] animate-pulse rounded-md bg-muted" />}>
      <MonthPickerInner {...props} />
    </Suspense>
  )
}

// getMonthFromParams вынесен в @/lib/month-params (для server components)
