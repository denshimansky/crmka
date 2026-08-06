"use client"

// Пикер конкретных занятий для пакетного абонемента с выбором
// (docs/package-lesson-selection-plan.md, фаза 3 UI). Показывает занятия группы в
// окне [windowStart..windowEnd], даёт отметить ровно targetCount штук. День недели —
// только предзаполнялка; источник истины — конкретные lessonId (value).

import { useEffect, useMemo, useState } from "react"
import { Label } from "@/components/ui/label"

interface LessonItem {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  instructorName: string | null
  isSubstitute: boolean
  isPast: boolean
}

const WD_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
const MONTH_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]
const MONTH_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
]

function utc(iso: string): Date {
  return new Date(iso)
}

export function PackageLessonPicker({
  groupId,
  windowStart,
  windowEnd,
  targetCount,
  value,
  onChange,
}: {
  groupId: string
  windowStart: string
  windowEnd: string
  targetCount: number
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [lessons, setLessons] = useState<LessonItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId || !windowStart || !windowEnd) {
      setLessons([])
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetch(`/api/groups/${groupId}/lessons?from=${windowStart}&to=${windowEnd}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: LessonItem[]) => {
        if (!cancelled) setLessons(Array.isArray(d) ? d : [])
      })
      .catch(() => {
        if (!cancelled) setErr("Не удалось загрузить занятия группы")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [groupId, windowStart, windowEnd])

  // Подрезаем выбор до доступных занятий, когда список меняется (сузилось окно/сменилась
  // группа) — иначе payload разойдётся с окном. onChange зовём только при отличии.
  useEffect(() => {
    // Не подрезаем, пока занятия ещё не загружены (lessons=[]): иначе в режиме правки
    // (value уже заполнен из GET) выбор обнулился бы ДО загрузки списка занятий.
    if (lessons.length === 0) return
    const ids = new Set(lessons.map((l) => l.id))
    const pruned = value.filter((id) => ids.has(id))
    if (pruned.length !== value.length) onChange(pruned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons])

  const selected = useMemo(() => new Set(value), [value])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const weekdays = useMemo(() => {
    const s = new Set<number>()
    for (const l of lessons) s.add(utc(l.date).getUTCDay())
    return [...s].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Пн..Вс
  }, [lessons])

  function toggleWeekday(wd: number) {
    const wdIds = lessons.filter((l) => utc(l.date).getUTCDay() === wd).map((l) => l.id)
    const allSel = wdIds.length > 0 && wdIds.every((id) => selected.has(id))
    const next = new Set(selected)
    for (const id of wdIds) {
      if (allSel) next.delete(id)
      else next.add(id)
    }
    onChange([...next])
  }

  const byMonth = useMemo(() => {
    const m = new Map<string, LessonItem[]>()
    for (const l of lessons) {
      const d = utc(l.date)
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      const arr = m.get(key)
      if (arr) arr.push(l)
      else m.set(key, [l])
    }
    return [...m.entries()]
  }, [lessons])

  const count = value.length
  const counterColor =
    count === targetCount
      ? "text-green-600"
      : count > targetCount
        ? "text-red-600"
        : "text-muted-foreground"

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Занятия пакета</Label>
        <span className={`text-sm font-medium ${counterColor}`}>
          Выбрано {count} / {targetCount}
          {count > targetCount && ` (уберите ${count - targetCount})`}
        </span>
      </div>

      {weekdays.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">По дням:</span>
          {weekdays.map((wd) => (
            <button
              key={wd}
              type="button"
              onClick={() => toggleWeekday(wd)}
              className="rounded-full border border-input px-2 py-0.5 text-xs hover:bg-muted/60"
            >
              {WD_SHORT[wd]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange(lessons.slice(0, targetCount).map((l) => l.id))}
            className="rounded-full border border-input px-2 py-0.5 text-xs hover:bg-muted/60"
          >
            Первые {targetCount}
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full border border-input px-2 py-0.5 text-xs hover:bg-muted/60"
          >
            Очистить
          </button>
        </div>
      )}

      {loading && <p className="text-xs text-muted-foreground">Загрузка занятий…</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!loading && !err && lessons.length < targetCount && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          В сроке пакета у группы только {lessons.length} занятий из нужных {targetCount}.
          Продлите срок, сдвиньте дату начала или сгенерируйте расписание группы дальше.
        </div>
      )}

      {byMonth.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-2">
          {byMonth.map(([key, items]) => {
            const [, mo] = key.split("-").map(Number)
            return (
              <div key={key} className="space-y-1">
                <div className="sticky top-0 bg-background/95 px-1 py-0.5 text-xs font-medium text-muted-foreground">
                  {MONTH_FULL[mo]}
                </div>
                {items.map((l) => {
                  const d = utc(l.date)
                  const isSel = selected.has(l.id)
                  return (
                    <label
                      key={l.id}
                      className={[
                        "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm",
                        isSel ? "bg-primary/5" : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(l.id)}
                        className="size-4"
                      />
                      <span className="w-24 shrink-0">
                        {WD_SHORT[d.getUTCDay()]}, {d.getUTCDate()} {MONTH_SHORT[d.getUTCMonth()]}
                      </span>
                      <span className="w-12 shrink-0 text-muted-foreground">{l.startTime}</span>
                      <span className="truncate text-muted-foreground">
                        {l.instructorName ?? ""}
                        {l.isSubstitute && " (зам.)"}
                      </span>
                      {l.isPast && (
                        <span className="ml-auto shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                          прошло
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
