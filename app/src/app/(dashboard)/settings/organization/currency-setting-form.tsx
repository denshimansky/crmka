"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Check, Loader2 } from "lucide-react"
import { CURRENCIES } from "@/lib/currency"

/**
 * Выбор валюты расчёта организации (Настройки → Организация). Меняет только
 * символ/формат отображения сумм — суммы по курсу НЕ пересчитываются.
 * Сохраняет через PATCH /api/organization { currency, currencyChosen: true }.
 */
export function CurrencySettingForm({ initial }: { initial: string }) {
  const router = useRouter()
  const [currency, setCurrency] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    if (next === currency) return
    const prev = currency
    setCurrency(next) // оптимистично
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: next, currencyChosen: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Не удалось сохранить")
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh() // пересчитать отображение сумм по всему приложению
    } catch (e) {
      setCurrency(prev)
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="currency" className="text-base font-medium">
              Валюта расчёта
            </Label>
            {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="size-4" /> Сохранено
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            В какой валюте центр ведёт расчёты. Меняет только символ и формат сумм во
            всём приложении (₽ → ₸/сўм/₴ …) — суммы по курсу не пересчитываются.
          </p>
          <select
            id="currency"
            value={currency}
            disabled={saving}
            onChange={(e) => change(e.target.value)}
            className="mt-1 h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
