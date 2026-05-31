"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { CreateApplicationDialog } from "./create-application-dialog"
import { TrialLessonDialog } from "./trial-lesson-dialog"

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "Новый" },
  { value: "trial_scheduled", label: "Пробное записано" },
  { value: "trial_attended", label: "Пробное пройдено" },
  { value: "awaiting_payment", label: "Ожидание оплаты" },
  { value: "potential", label: "Потенциальный" },
  { value: "non_target", label: "Не целевой" },
  { value: "blacklisted", label: "Чёрный список" },
  { value: "archived", label: "Архив" },
]

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

// Доступные переходы для активного клиента (есть активный абонемент).
// Перевести в Лиды/Потенциал/etc. нельзя — клиент уже «прошёл» воронку.
const ACTIVE_TRANSITIONS: { value: string; label: string }[] = [
  { value: "churned", label: "В Выбывшие" },
  { value: "archived", label: "В Архив" },
  { value: "blacklisted", label: "В Чёрный список" },
]

export function LeadStatusActions({
  clientId,
  currentStatus,
  wards,
  isActiveClient = false,
}: {
  clientId: string
  currentStatus: string
  wards: WardLite[]
  // Активный клиент — селектор воронки заменяем на ограниченный набор
  // переходов (Выбывшие/Архив/ЧС); запись на пробное по-прежнему доступна
  isActiveClient?: boolean
}) {
  const router = useRouter()
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusValue, setStatusValue] = useState(currentStatus)

  // Когда родитель перерисовался после router.refresh() — синхронизируем
  useEffect(() => {
    setStatusValue(currentStatus)
  }, [currentStatus])

  async function handleActiveTransition(value: string | null) {
    if (!value) return
    setStatusLoading(true)
    try {
      const body =
        value === "churned"
          ? { clientStatus: "churned" }
          : { funnelStatus: value }
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось сменить статус")
      }
    } catch {
      alert("Ошибка сети")
    } finally {
      setStatusLoading(false)
    }
  }

  async function handleStatusChange(value: string | null) {
    if (!value || value === statusValue) return
    setStatusValue(value)
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelStatus: value }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setStatusValue(currentStatus)
      }
    } catch {
      setStatusValue(currentStatus)
    } finally {
      setStatusLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isActiveClient ? (
        <Select value="" onValueChange={handleActiveTransition}>
          <SelectTrigger
            className="h-7 min-w-[170px] text-xs"
            disabled={statusLoading}
          >
            <span className="text-muted-foreground">Сменить статус…</span>
          </SelectTrigger>
          <SelectContent>
            {ACTIVE_TRANSITIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select value={statusValue} onValueChange={handleStatusChange}>
          <SelectTrigger
            className="h-7 min-w-[170px] text-xs"
            disabled={statusLoading}
          >
            {STATUS_OPTIONS.find((s) => s.value === statusValue)?.label ||
              statusValue}
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <CreateApplicationDialog clientId={clientId} wards={wards} />

      <TrialLessonDialog clientId={clientId} wards={wards} />
    </div>
  )
}
