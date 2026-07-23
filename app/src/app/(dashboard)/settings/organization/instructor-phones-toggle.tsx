"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Check, Loader2 } from "lucide-react"

// Переключатель «Инструкторы видят телефоны клиентов» (Настройки → Организация).
// По умолчанию у роли instructor телефоны замаскированы; владелец может открыть.
// Сохраняет через PATCH /api/organization { instructorsSeePhones }.
export function InstructorPhonesToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    const prev = enabled
    setEnabled(next) // оптимистично
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorsSeePhones: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Не удалось сохранить")
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setEnabled(prev) // откат при ошибке
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="instructorsSeePhones" className="text-base font-medium">
              Инструкторы видят телефоны клиентов
            </Label>
            <p className="text-sm text-muted-foreground">
              По умолчанию телефоны учеников и родителей у роли «инструктор» скрыты (•••••).
              Включите, чтобы инструкторы видели номера. Управляющий и администратор видят их всегда.
              Изменение применяется в течение нескольких минут.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && (
              <p className="flex items-center gap-1 text-sm text-green-600">
                <Check className="size-4" /> Сохранено
              </p>
            )}
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center pt-1">
            <input
              id="instructorsSeePhones"
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              disabled={saving}
              onChange={(e) => toggle(e.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-muted transition-colors after:absolute after:left-0.5 after:top-1.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5" />
            {saving && <Loader2 className="ml-2 size-4 animate-spin text-muted-foreground" />}
          </label>
        </div>
      </CardContent>
    </Card>
  )
}
