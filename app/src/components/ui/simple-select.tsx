"use client"

import * as React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface SimpleSelectOption {
  id: string
  name: string
}

/** Значение «ничего не выбрано» внутри base-ui: пустую строку он трактует как
 *  отсутствие значения, поэтому подменяем её сентинелом. */
const EMPTY_SENTINEL = "__empty__"

/**
 * Выпадающий список из плоского набора опций — для фильтров (филиал, направление,
 * группа) и простых форм.
 *
 * Зачем вместо нативного `<select>`: у нативного списка нет своей высоты — при
 * 30+ направлениях он разворачивается на весь экран и уезжает за край окна
 * («не влезает список направлений»). Здесь выпадашка открывается под триггером
 * (`alignItemWithTrigger={false}`), ограничена по высоте и прокручивается,
 * а длинные названия обрезаются многоточием, чтобы не растягивать панель фильтров.
 *
 * Первый пункт — сброс: `emptyLabel` со значением `emptyValue` («Все филиалы»
 * для фильтров, «— выберите филиал —» для форм).
 */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  emptyLabel,
  emptyValue = "all",
  className,
  disabled,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SimpleSelectOption[]
  /** Подпись пункта-сброса; она же показывается на триггере, когда ничего не выбрано. */
  emptyLabel: string
  /** Значение пункта-сброса, как его ждёт вызывающий код ("all", "" и т. п.). */
  emptyValue?: string
  className?: string
  disabled?: boolean
}) {
  const toInner = (v: string) => (v === "" ? EMPTY_SENTINEL : v)
  const fromInner = (v: string) => (v === EMPTY_SENTINEL ? "" : v)
  const selected = options.find((o) => o.id === value)

  return (
    <Select
      value={toInner(value)}
      onValueChange={(v) => onValueChange(fromInner(String(v)))}
      disabled={disabled}
    >
      <SelectTrigger className={cn("w-[180px]", className)}>
        <span className="truncate">{selected ? selected.name : emptyLabel}</span>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="max-h-[min(18rem,var(--available-height))]">
        <SelectItem value={toInner(emptyValue)}>{emptyLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
