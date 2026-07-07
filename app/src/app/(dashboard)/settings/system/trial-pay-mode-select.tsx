"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

const MODE_LABELS: Record<string, string> = {
  none: "Не платить",
  paid_only: "Только платные",
  all: "Все пробные",
}

const MODE_HINTS: Record<string, string> = {
  none: "ЗП за пробные не начисляется",
  paid_only: "Начисляется, если у направления задана цена пробного",
  all: "Начисляется за любое пробное, включая бесплатные",
}

// Режим задаёт дефолт галочки «Оплата инструктору» у новых пробных; на
// конкретном пробном её по-прежнему можно переключить в карточке занятия.
// Уже отмеченные посещения смена режима не пересчитывает.
export function TrialPayModeSelect({
  value,
  canEdit,
}: {
  value: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState(value)
  const [loading, setLoading] = useState(false)

  if (!canEdit) {
    return (
      <Badge variant={value === "none" ? "secondary" : "default"}>
        {MODE_LABELS[value] ?? value}
      </Badge>
    )
  }

  async function handleChange(v: string | null) {
    if (!v || v === mode) return
    const prev = mode
    setMode(v)
    setLoading(true)
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialPayMode: v }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setMode(prev)
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось сохранить настройку")
      }
    } catch {
      setMode(prev)
      alert("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Select value={mode} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-[180px] text-sm" disabled={loading}>
          {MODE_LABELS[mode] ?? mode}
        </SelectTrigger>
        <SelectContent>
          {Object.entries(MODE_LABELS).map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {MODE_HINTS[mode] && (
        <p className="max-w-[260px] text-right text-xs text-muted-foreground">
          {MODE_HINTS[mode]}
        </p>
      )}
    </div>
  )
}
