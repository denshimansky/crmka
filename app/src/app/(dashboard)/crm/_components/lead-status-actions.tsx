"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

// Этапы воронки продаж (Пробное / Прошёл пробное / Ожидание оплаты) переехали
// на подопечного (Ward.salesStage) — селектор статуса родителя описывает только
// «качество контакта»: лид, потенциальный, не целевой, ЧС, архив.
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "Лид" },
  { value: "potential", label: "Потенциальный" },
  { value: "non_target", label: "Не целевой" },
  { value: "blacklisted", label: "Чёрный список" },
  { value: "archived", label: "Архив" },
]

// Доступные переходы для активного клиента (есть активный абонемент).
// Перевести в Лиды/Потенциал/etc. нельзя — клиент уже «прошёл» воронку.
const ACTIVE_TRANSITIONS: { value: string; label: string }[] = [
  { value: "churned", label: "В Выбывшие" },
  { value: "archived", label: "В Архив" },
  { value: "blacklisted", label: "В Чёрный список" },
]

// Полный набор подписей для отображения текущего funnelStatus в триггере
// селекта (включая значения, которых нет в STATUS_OPTIONS — например,
// `active_client` остаётся на родителе у выбывших). Без этой карты в кнопку
// просачивается сырой enum («active_client»).
const STATUS_LABELS: Record<string, string> = {
  new: "Лид",
  potential: "Потенциальный",
  non_target: "Не целевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
  active_client: "Активный клиент",
  trial_scheduled: "Пробное записано",
  trial_attended: "Прошёл пробное",
  awaiting_payment: "Ожидание оплаты",
}

export function LeadStatusActions({
  clientId,
  currentStatus,
  isActiveClient = false,
}: {
  clientId: string
  currentStatus: string
  // Активный клиент — селектор воронки заменяем на ограниченный набор
  // переходов (Выбывшие/Архив/ЧС).
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
            {STATUS_LABELS[statusValue] ?? statusValue}
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
    </div>
  )
}
