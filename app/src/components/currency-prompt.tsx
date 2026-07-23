"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/currency"

/**
 * Разовый запрос валюты расчёта для НОВОЙ организации (currencyChosen=false).
 * Показывается на дашборде владельцу/управляющему. Сохраняет выбор через
 * PATCH /api/organization { currency, currencyChosen: true } — после чего
 * больше не появляется. Валюту всегда можно сменить в «Настройки → Организация».
 */
export function CurrencyPrompt({ initial = DEFAULT_CURRENCY }: { initial?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [currency, setCurrency] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, currencyChosen: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Не удалось сохранить")
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>В какой валюте вы работаете?</DialogTitle>
          <DialogDescription>
            Выберите валюту расчёта — в ней будут отображаться все суммы в системе.
            Позже её можно сменить в «Настройки → Организация». Суммы по курсу не
            пересчитываются, меняется только символ и формат.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <select
          value={currency}
          disabled={saving}
          onChange={(e) => setCurrency(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>

        <DialogFooter>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
