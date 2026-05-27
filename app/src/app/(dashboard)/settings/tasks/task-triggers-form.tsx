"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Loader2, Sparkles } from "lucide-react"
import { TRIGGER_LABEL, type TriggerSetting } from "@/lib/tasks/trigger-settings"

interface Props {
  initial: TriggerSetting[]
}

export function TaskTriggersForm({ initial }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<TriggerSetting[]>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  function update(idx: number, patch: Partial<TriggerSetting>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/task-triggers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: items }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить")
        return
      }
      setSavedAt(new Date())
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          <Sparkles className="size-4 shrink-0 mt-0.5 text-primary" />
          <p>
            Автоматические задачи создаются при запуске генератора («Сгенерировать задачи»
            в разделе «Задачи»). Здесь можно временно выключить отдельные триггеры или
            ограничить их работу определённым диапазоном дней месяца (например, напоминать
            об оплате только с 5-го числа).
          </p>
        </div>

        <div className="divide-y rounded-lg border">
          {items.map((it, idx) => (
            <div key={it.trigger} className="flex items-start gap-3 p-3">
              <Checkbox
                checked={it.enabled}
                onCheckedChange={(v) => update(idx, { enabled: v === true })}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{TRIGGER_LABEL[it.trigger]}</div>
                <div className="text-xs text-muted-foreground">{it.trigger}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">с</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="—"
                  value={it.startDayOfMonth ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    update(idx, {
                      startDayOfMonth:
                        !e.target.value || isNaN(n) || n < 1 || n > 31 ? null : n,
                    })
                  }}
                  disabled={!it.enabled}
                  className="h-8 w-16"
                />
                <span className="text-muted-foreground">числа месяца</span>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-xs text-muted-foreground">
            {savedAt
              ? `Сохранено ${savedAt.toLocaleTimeString("ru-RU")}`
              : "Изменения применяются после нажатия «Сохранить»"}
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
