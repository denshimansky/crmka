"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ClientComboboxOption {
  id: string
  name: string
}

interface ClientComboboxProps {
  options: ClientComboboxOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  /** Сколько строк показывать максимум в выпадашке. По умолчанию 50 — чтобы DOM не вспух при 5к клиентах. */
  maxResults?: number
  className?: string
}

/**
 * Селект-комбобокс с поиском по подстроке (по имени).
 * Поиск идёт без учёта регистра. Если введён непустой запрос — снимает выбранного клиента
 * пока пользователь не выберет вариант из выпадашки.
 */
export function ClientCombobox({
  options,
  value,
  onChange,
  placeholder = "Выберите клиента",
  maxResults = 50,
  className,
}: ClientComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const containerRef = React.useRef<HTMLDivElement>(null)

  const selected = React.useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  )

  // При клике вне комбобокса — закрываем и сбрасываем введённый запрос
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = React.useMemo(() => {
    if (!q) return options.slice(0, maxResults)
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, maxResults)
  }, [options, q, maxResults])

  // Что показываем во вводе: пока открыт — то, что юзер печатает; пока закрыт — имя выбранного.
  const display = open ? query : selected?.name ?? ""

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Input
          value={display}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true)
            setQuery("")
          }}
          onChange={(e) => {
            setOpen(true)
            setQuery(e.target.value)
          }}
          className="pr-8"
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Ничего не найдено</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => {
                  // Используем mousedown, чтобы клик отработал до blur и не потерять выбор
                  e.preventDefault()
                  onChange(o.id)
                  setQuery("")
                  setOpen(false)
                }}
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm hover:bg-accent",
                  o.id === value && "bg-accent/50 font-medium",
                )}
              >
                {o.name}
              </button>
            ))
          )}
          {!q && options.length > maxResults && (
            <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              Показано {maxResults} из {options.length}. Уточните запрос.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
