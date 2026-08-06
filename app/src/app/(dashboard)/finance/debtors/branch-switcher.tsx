"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Building2 } from "lucide-react"

const ALL_VALUE = "all"

interface BranchOption {
  id: string
  name: string
}

/**
 * Переключатель филиалов для страницы «Долг/Баланс» (баг #107).
 *
 * Как на /schedule — одиночный выбор «Все филиалы» / конкретный филиал.
 * Значение хранится в URL (?branch=<id>), поэтому фильтрация делается на
 * сервере, а остальные параметры (вкладка ?tab) сохраняются при переключении.
 */
export function BranchSwitcher({
  branches,
  selected,
}: {
  branches: BranchOption[]
  selected: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setBranch(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === ALL_VALUE) params.delete("branch")
    else params.set("branch", value)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const current = selected ?? ALL_VALUE

  return (
    <Select value={current} onValueChange={(v) => v && setBranch(v)}>
      <SelectTrigger className="w-[220px]">
        <span className="flex items-center gap-1.5">
          <Building2 className="size-3.5 text-muted-foreground" />
          {current === ALL_VALUE
            ? "Все филиалы"
            : branches.find((b) => b.id === current)?.name || "Филиал"}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>Все филиалы</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
