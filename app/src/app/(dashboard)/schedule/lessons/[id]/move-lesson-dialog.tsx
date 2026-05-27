"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CalendarClock, Loader2, AlertTriangle } from "lucide-react"

interface MoveLessonDialogProps {
  lessonId: string
  currentDateISO: string
  currentStartTime: string
  currentDurationMinutes: number
  attendancesCount: number
  /** Кнопка показывается только когда пользователь имеет право переносить это занятие. */
  canMove: boolean
}

export function MoveLessonDialog({
  lessonId,
  currentDateISO,
  currentStartTime,
  currentDurationMinutes,
  attendancesCount,
  canMove,
}: MoveLessonDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(currentDateISO)
  const [startTime, setStartTime] = useState(currentStartTime)
  const [duration, setDuration] = useState<number>(currentDurationMinutes)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [conflicts, setConflicts] = useState<
    { id: string; startTime: string; groupName: string; roomName: string | null }[] | null
  >(null)

  if (!canMove) return null

  function reset() {
    setDate(currentDateISO)
    setStartTime(currentStartTime)
    setDuration(currentDurationMinutes)
    setError(null)
    setNeedsConfirm(false)
    setConflicts(null)
  }

  const isChanged =
    date !== currentDateISO ||
    startTime !== currentStartTime ||
    duration !== currentDurationMinutes

  async function submit(confirmReset: boolean) {
    setSubmitting(true)
    setError(null)
    setConflicts(null)
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          startTime,
          durationMinutes: duration,
          ...(confirmReset ? { confirmResetAttendances: true } : {}),
        }),
      })

      if (res.ok) {
        setOpen(false)
        reset()
        router.refresh()
        return
      }

      const data = await res.json().catch(() => ({}))

      // 409 + requiresConfirmation → показываем экран подтверждения сброса отметок
      if (res.status === 409 && data.requiresConfirmation) {
        setNeedsConfirm(true)
        setError(null)
        return
      }
      // 409 + conflicts → конфликт расписания (педагог/кабинет)
      if (res.status === 409 && Array.isArray(data.conflicts)) {
        setConflicts(data.conflicts)
        setError(data.error || "Конфликт расписания")
        return
      }

      setError(data.error || "Не удалось перенести занятие")
    } catch {
      setError("Ошибка сети")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <CalendarClock className="mr-2 size-4" />
        Перенести
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {needsConfirm ? "Подтвердите сброс отметок" : "Перенос занятия"}
          </DialogTitle>
        </DialogHeader>

        {!needsConfirm && (
          <div className="space-y-4">
            {attendancesCount > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  На занятии {attendancesCount} {wordOtmetok(attendancesCount)}. При переносе они
                  будут <strong>сброшены</strong>, списания с абонементов и начисления ЗП —
                  откатятся.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="move-date">Новая дата</Label>
                <Input
                  id="move-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="move-start">Начало</Label>
                <Input
                  id="move-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="move-duration">Длительность, мин</Label>
              <Input
                id="move-duration"
                type="number"
                min={5}
                max={600}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 0)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {conflicts && conflicts.length > 0 && (
              <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <div className="font-medium text-destructive">Конфликтуют:</div>
                <ul className="space-y-0.5">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      {c.startTime} — {c.groupName}
                      {c.roomName && ` (${c.roomName})`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Отмена
              </DialogClose>
              <Button
                onClick={() => submit(false)}
                disabled={submitting || !isChanged || !date || !startTime || !duration}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  "Перенести"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {needsConfirm && (
          <div className="space-y-3">
            <div className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              На занятии есть отметки ({attendancesCount} шт.). При переносе все они будут
              удалены, списания с абонементов будут возвращены, начисленная ЗП — снята.
              <br />
              <br />
              <strong>Действие необратимо.</strong> После переноса отметки придётся проставить
              заново.
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Новое время: <strong>{date}</strong> в <strong>{startTime}</strong> ({duration} мин)
            </div>
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setNeedsConfirm(false)} type="button">
                Назад
              </Button>
              <Button variant="destructive" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  "Сбросить отметки и перенести"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function wordOtmetok(n: number): string {
  const last2 = n % 100
  if (last2 >= 11 && last2 <= 14) return "отметок"
  const last = n % 10
  if (last === 1) return "отметка"
  if (last >= 2 && last <= 4) return "отметки"
  return "отметок"
}
