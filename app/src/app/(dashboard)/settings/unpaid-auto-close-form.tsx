"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function UnpaidAutoCloseForm({ initialValue }: { initialValue: number | null }) {
  const router = useRouter()
  const [value, setValue] = useState<string>(initialValue ? String(initialValue) : "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const trimmed = value.trim()
      const payload: { unpaidSubscriptionAutoCloseDays: number | null } = trimmed === ""
        ? { unpaidSubscriptionAutoCloseDays: null }
        : { unpaidSubscriptionAutoCloseDays: Number(trimmed) }
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить настройку")
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm" htmlFor="unpaid-days">
        Авто-закрытие неоплаченного абонемента (дн.)
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="unpaid-days"
          type="number"
          min={1}
          max={365}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Выключено"
          className="w-32"
        />
        <Button type="button" onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Сохраняю…" : "Сохранить"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Если ребёнок зачислен, но абонемент не оплачен (balance &gt; 0) и нет ни одного посещения,
        через N дней после старта абонемент закрывается автоматически. Пусто = выключено.
      </p>
      {error && <div className="text-xs text-destructive">{error}</div>}
      {saved && <div className="text-xs text-green-600">Сохранено</div>}
    </div>
  )
}
