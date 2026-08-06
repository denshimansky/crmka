"use client"

// Правка выбора занятий существующего пакета (swap, фаза 6b UI). Переиспользует
// PackageLessonPicker: грузит текущий выбор+окно (GET), сохраняет набор (PATCH).
// Удалить из плана отмеченное занятие нельзя — сервер вернёт 409 (сначала снять
// отметку в карточке занятия).

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ListChecks } from "lucide-react"
import { PackageLessonPicker } from "./package-lesson-picker"

export function EditPackageLessonsDialog({
  subscriptionId,
  onSuccess,
}: {
  subscriptionId: string
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [groupId, setGroupId] = useState("")
  const [windowStart, setWindowStart] = useState("")
  const [windowEnd, setWindowEnd] = useState<string | null>(null)
  const [targetCount, setTargetCount] = useState(0)
  const [value, setValue] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/subscriptions/${subscriptionId}/lessons`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => {
        if (cancelled) return
        setGroupId(d.groupId)
        setWindowStart(d.windowStart)
        setWindowEnd(d.windowEnd)
        setTargetCount(d.totalLessons)
        setValue(d.lessonIds || [])
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить выбор занятий")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, subscriptionId])

  async function save() {
    if (value.length !== targetCount) {
      setError(`Отметьте ровно ${targetCount} занятий (выбрано ${value.length})`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/lessons`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedLessonIds: value }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить занятия")
        return
      }
      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Изменить занятия пакета"
        onClick={() => setOpen(true)}
      >
        <ListChecks className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Занятия пакета</DialogTitle>
          </DialogHeader>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">Загрузка…</p>
          ) : (
            <div className="space-y-3">
              {windowStart && (
                <PackageLessonPicker
                  groupId={groupId}
                  windowStart={windowStart}
                  windowEnd={windowEnd || windowStart}
                  targetCount={targetCount}
                  value={value}
                  onChange={setValue}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Отмеченное занятие из плана убрать нельзя — сначала снимите отметку в карточке занятия.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={save} disabled={saving || value.length !== targetCount}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
