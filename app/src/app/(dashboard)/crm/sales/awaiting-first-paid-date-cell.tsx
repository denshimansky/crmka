"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Calendar } from "@/components/ui/calendar"
import { CalendarDays, Loader2, AlertCircle } from "lucide-react"

/**
 * Ячейка «Дата 1-го платного» на вкладке «Ожидаем оплату».
 *
 * Отличается от обычного EditableDateCell тем, что:
 *  1) в календаре кликабельны только даты реальных занятий группы абонемента;
 *  2) при сохранении вызывает пересчёт абонемента (POST .../reschedule-start) —
 *     количество занятий и стоимость пересчитываются под новую дату старта.
 */
export function AwaitingFirstPaidDateCell({
  subscriptionId,
  groupId,
  initialDate,
}: {
  subscriptionId: string
  groupId: string
  initialDate: string // YYYY-MM-DD или ""
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(initialDate)
  const [lessonDates, setLessonDates] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDate(initialDate)
  }, [initialDate])

  // Реальные даты занятий группы — кликабельны только они. includePast=1, чтобы
  // можно было сдвинуть старт задним числом (ребёнок мог уже начать ходить).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLessonDates(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/groups/${groupId}/lessons?includePast=1`)
        if (cancelled) return
        if (!res.ok) {
          setLessonDates([])
          return
        }
        const lessons: { date: string }[] = await res.json()
        if (cancelled) return
        setLessonDates(lessons.map((l) => l.date.slice(0, 10)))
      } catch {
        if (!cancelled) setLessonDates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, groupId])

  function fmt(d: string): string {
    if (!d) return "—"
    const [y, m, day] = d.split("-")
    return `${day}.${m}.${y}`
  }

  async function save() {
    if (!date || date === initialDate) {
      setOpen(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/reschedule-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstPaidLessonDate: date }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось пересчитать абонемент")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-[140px] justify-start text-xs font-normal"
        onClick={() => {
          setError(null)
          setDate(initialDate)
          setOpen(true)
        }}
      >
        <CalendarDays className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
        {fmt(initialDate)}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Дата первого платного занятия</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Доступны только даты занятий группы. После сохранения количество
            занятий и стоимость абонемента пересчитаются под новую дату старта.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {lessonDates === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загрузка занятий…
            </div>
          ) : (
            <Calendar
              value={date}
              onChange={setDate}
              availableDates={new Set(lessonDates)}
              emptyHint="У группы нет занятий. Перегенерируйте расписание группы."
            />
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={save} disabled={saving || !date}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Пересчёт…
                </>
              ) : (
                "Сохранить"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
