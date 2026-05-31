"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

// Этап воронки продаж по подопечному. Автоматически выставляется при создании
// заявки/пробного и при отметке посещения. Перевод в «Ожидание оплаты» —
// основной ручной кейс (после консультации с родителем).
const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Вне воронки" },
  { value: "application", label: "Заявка" },
  { value: "trial_scheduled", label: "Пробное записано" },
  { value: "trial_attended", label: "Прошёл пробное" },
  { value: "awaiting_payment", label: "Ожидание оплаты" },
]

export function WardSalesStageActions({
  wardId,
  currentStage,
  disabled = false,
}: {
  wardId: string
  currentStage: string
  // Активный абонемент → выводит подопечного из воронки; селектор лучше скрыть.
  disabled?: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState(currentStage)

  useEffect(() => {
    setValue(currentStage)
  }, [currentStage])

  async function handleChange(next: string | null) {
    if (!next || next === value) return
    setValue(next)
    setLoading(true)
    try {
      const res = await fetch(`/api/wards/${wardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesStage: next }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setValue(currentStage)
      }
    } catch {
      setValue(currentStage)
    } finally {
      setLoading(false)
    }
  }

  if (disabled) return null

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="h-7 min-w-[170px] text-xs" disabled={loading}>
        {STAGE_OPTIONS.find((s) => s.value === value)?.label || value}
      </SelectTrigger>
      <SelectContent>
        {STAGE_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
