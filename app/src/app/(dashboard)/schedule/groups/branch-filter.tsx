"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Filter, X } from "lucide-react"

interface BranchOption {
  id: string
  name: string
}

export function BranchFilter({
  branches,
  selected,
}: {
  branches: BranchOption[]
  selected: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedSet = new Set(selected)

  function applySelection(ids: string[]) {
    const params = new URLSearchParams(searchParams.toString())
    if (ids.length === 0 || ids.length === branches.length) {
      params.delete("branches")
    } else {
      params.set("branches", ids.join(","))
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(selectedSet)
    if (checked) next.add(id)
    else next.delete(id)
    applySelection(Array.from(next))
  }

  function reset() {
    applySelection([])
  }

  // Если в URL нет параметра — считаем «все филиалы»;
  // иначе показываем количество или имя выбранного.
  const label = (() => {
    if (selected.length === 0) return "Все филиалы"
    if (selected.length === 1) {
      return branches.find((b) => b.id === selected[0])?.name || "Филиал"
    }
    return `Филиалы: ${selected.length}`
  })()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
      >
        <Filter className="size-3.5" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuItem closeOnClick={false} onClick={reset}>
          <X className="size-3.5" />
          Все филиалы
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {branches.map((b) => (
          <DropdownMenuCheckboxItem
            key={b.id}
            closeOnClick={false}
            checked={selectedSet.has(b.id)}
            onCheckedChange={(v) => toggle(b.id, !!v)}
          >
            {b.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
