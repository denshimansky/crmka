"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { UserRound } from "lucide-react"

const ALL_VALUE = "all"

interface StatusOption {
  key: string
  label: string
}

/**
 * Фильтр по статусу клиента для страницы «Долг/Баланс» (баг #109) — отличать
 * активных от выбывших и прочих. Одиночный выбор, значение в URL (?status=<key>),
 * фильтрация на сервере; прочие параметры (вкладка, филиал) сохраняются.
 */
export function StatusFilter({
  options,
  selected,
}: {
  options: StatusOption[]
  selected: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setStatus(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === ALL_VALUE) params.delete("status")
    else params.set("status", value)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const current = selected ?? ALL_VALUE

  return (
    <Select value={current} onValueChange={(v) => v && setStatus(v)}>
      <SelectTrigger className="w-[200px]">
        <span className="flex items-center gap-1.5">
          <UserRound className="size-3.5 text-muted-foreground" />
          {current === ALL_VALUE
            ? "Все статусы"
            : options.find((o) => o.key === current)?.label || "Статус"}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>Все статусы</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
