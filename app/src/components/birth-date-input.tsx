"use client"

import * as React from "react"
import { CalendarDays, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"

/** ISO (YYYY-MM-DD) → отображение ДД.ММ.ГГГГ; прочее (в т.ч. "") → пусто. */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ""
}

interface BirthDateInputProps {
  /** Значение в ISO (YYYY-MM-DD) или "" — как хранит/шлёт форма. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Выбор даты рождения календарём во всплывающем окне (Popover + Calendar с
 * выпадашками месяца/года для быстрого прыжка на нужный год). Полностью
 * контролируемый — стартует ПУСТЫМ на всех платформах: нативный <input type="date">
 * на macOS при пустом значении подставлял сегодняшнюю дату, здесь такого нет
 * (значение задаём только явным кликом по дню, при value="" ничего не выбрано).
 * Наружу отдаём ISO (YYYY-MM-DD) или "" — контракт value/onChange не изменился.
 */
export function BirthDateInput({ value, onChange, disabled, className }: BirthDateInputProps) {
  const [open, setOpen] = React.useState(false)
  const display = isoToDisplay(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start gap-2 font-normal",
              !display && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarDays className="size-4 opacity-70" />
        {display || "дд.мм.гггг"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          value={value}
          onChange={(iso) => {
            onChange(iso)
            setOpen(false)
          }}
          monthYearNav
          className="border-0 bg-transparent p-0"
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-muted-foreground"
            onClick={() => {
              onChange("")
              setOpen(false)
            }}
          >
            <X className="size-3.5" /> Очистить
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
