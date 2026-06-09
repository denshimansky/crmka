"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Tag } from "lucide-react"

interface TemplateOption {
  id: string
  name: string
  kind: "permanent" | "linked_sibling" | "linked_second_direction"
  valueType: "percent" | "fixed"
  value: string | number
  isActive: boolean
  systemKey: string | null
}

function shortTitle(t: TemplateOption): string {
  const v = Number(t.value)
  const suffix =
    t.valueType === "percent" ? `${v}%` : `${v.toLocaleString("ru-RU")} ₽/занятие`
  return `${t.name} (${suffix})`
}

// Минимальное число подопечных у клиента для linked-видов шаблона.
function requiredWardsFor(kind: TemplateOption["kind"]): number {
  if (kind === "linked_sibling") return 2
  if (kind === "linked_second_direction") return 1
  return 0
}

function unavailableReason(
  kind: TemplateOption["kind"],
  wardsCount: number,
): string | null {
  const need = requiredWardsFor(kind)
  if (wardsCount >= need) return null
  if (kind === "linked_sibling") return "Нужно минимум 2 подопечных"
  if (kind === "linked_second_direction") return "Нужен хотя бы один подопечный"
  return null
}

export function ClientDiscountSelect({
  clientId,
  initialTemplateId,
  wardsCount,
}: {
  clientId: string
  initialTemplateId: string | null
  wardsCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<TemplateOption[]>([])
  const [value, setValue] = useState<string>(initialTemplateId ?? "none")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    fetch("/api/discount-templates?isActive=true")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        setOptions(Array.isArray(data) ? data : [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [open, loaded])

  async function commit(next: string) {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discountTemplateId: next === "none" ? null : next }),
      })
      if (res.ok) {
        setValue(next)
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        if (data?.error) alert(data.error)
      }
    } finally {
      setLoading(false)
    }
  }

  const selected = options.find((o) => o.id === value)
  const label = selected ? shortTitle(selected) : value === "none" ? "Без скидки" : "…"

  return (
    <Select
      value={value}
      onOpenChange={setOpen}
      onValueChange={(v) => { if (v) commit(v) }}
    >
      <SelectTrigger className="h-8 min-w-[220px] max-w-[420px] text-xs">
        <Tag className="size-3 mr-1.5 text-muted-foreground shrink-0" />
        <span className="truncate" title={label}>{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Без скидки</SelectItem>
        {options.map((o) => {
          const reason = unavailableReason(o.kind, wardsCount)
          return (
            <SelectItem key={o.id} value={o.id} disabled={reason !== null}>
              {shortTitle(o)}
              {reason && (
                <span className="ml-2 text-xs text-muted-foreground">— {reason}</span>
              )}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
