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

export function ClientDiscountSelect({
  clientId,
  initialTemplateId,
}: {
  clientId: string
  initialTemplateId: string | null
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
      <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
        <Tag className="size-3 mr-1.5 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Без скидки</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>{shortTitle(o)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
