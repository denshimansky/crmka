"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Tag } from "lucide-react"

// Скидки v2: вручную выбирается только постоянная скидка (тип 2).
// Автоскидка «за второй абонемент» (тип 1) показывается индикатором,
// когда она действует на абонементах клиента, — выбрать или снять её
// руками нельзя (управляется только тогглом в настройках организации).

interface TemplateOption {
  id: string
  name: string
  kind: string
  valueType: "percent" | "fixed"
  value: string | number
  isActive: boolean
  systemKey: string | null
}

function shortTitle(t: {
  name: string
  valueType: "percent" | "fixed"
  value: string | number
}): string {
  const v = Number(t.value)
  const suffix =
    t.valueType === "percent" ? `${v}%` : `−${v.toLocaleString("ru-RU")} ₽/занятие`
  return `${t.name} (${suffix})`
}

export function ClientDiscountSelect({
  clientId,
  initialTemplateId,
  initialTemplate,
  hasType1Discount,
}: {
  clientId: string
  initialTemplateId: string | null
  // Текущий шаблон скидки — чтобы показать название СРАЗУ, не дожидаясь
  // открытия дропдауна (список шаблонов грузится лениво). Без этого триггер
  // показывал «…» вместо названия (баг #74).
  initialTemplate?: {
    id: string
    name: string
    valueType: "percent" | "fixed"
    value: string | number
  } | null
  /** Действует ли на абонементах клиента автоскидка «за второй абонемент». */
  hasType1Discount?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<TemplateOption[]>([])
  const [value, setValue] = useState<string>(initialTemplateId ?? "none")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    fetch("/api/discount-templates?isActive=true&kind=permanent")
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

  // Название берём из загруженного списка; пока он не загружен (или шаблон уже
  // деактивирован и в списке его нет) — из initialTemplate, переданного сервером.
  const selected = options.find((o) => o.id === value)
  const label = selected
    ? shortTitle(selected)
    : value !== "none" && initialTemplate
      ? shortTitle(initialTemplate)
      : value !== "none"
        ? "…"
        : hasType1Discount
          ? "Скидка за второй абонемент (авто)"
          : "Без скидки"

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
        <SelectItem value="none">
          {hasType1Discount ? "Без скидки (действует автоскидка)" : "Без скидки"}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {shortTitle(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
