"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"

interface LessonItem {
  id: string
  date: string // YYYY-MM-DD
  startTime: string
  group: {
    name: string
    directionId: string
  }
  isTrial?: boolean
  href?: string
}

interface MonthCalendarViewProps {
  lessons: LessonItem[]
  gridDays: { date: string; inCurrentMonth: boolean }[]
  weekdayNames: string[]
  directionColorMap: Record<string, string>
  todayKey: string
}

export function MonthCalendarView({
  lessons,
  gridDays,
  weekdayNames,
  directionColorMap,
  todayKey,
}: MonthCalendarViewProps) {
  // Группируем уроки по дате
  const byDate = new Map<string, LessonItem[]>()
  for (const l of lessons) {
    const arr = byDate.get(l.date) ?? []
    arr.push(l)
    byDate.set(l.date, arr)
  }
  // Сортировка внутри дня по времени уже была на сервере, но повторим на всякий случай
  for (const [, arr] of byDate) {
    arr.sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] grid-cols-7 gap-px bg-border">
        {weekdayNames.map((n) => (
          <div
            key={n}
            className="sticky top-0 z-10 border-b bg-muted/50 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {n}
          </div>
        ))}
        {gridDays.map((cell, i) => {
          const dayLessons = byDate.get(cell.date) ?? []
          const isToday = cell.date === todayKey
          return (
            <div
              key={`${cell.date}-${i}`}
              className={`flex min-h-[110px] flex-col gap-0.5 bg-background p-1.5 ${
                !cell.inCurrentMonth ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-end">
                <span
                  className={`text-xs font-medium ${
                    isToday
                      ? "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      : cell.inCurrentMonth
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {new Date(cell.date + "T00:00:00").getDate()}
                </span>
              </div>
              <div className="flex-1 space-y-0.5">
                {dayLessons.map((lesson) => {
                  const colorClass = directionColorMap[lesson.group.directionId] || ""
                  return (
                    <Link
                      key={lesson.id}
                      href={lesson.href || `/schedule/lessons/${lesson.id}`}
                      className={`flex items-center gap-1 truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-tight ${colorClass} hover:opacity-80`}
                      title={`${lesson.startTime} · ${lesson.group.name}`}
                    >
                      <span className="font-mono">{lesson.startTime}</span>
                      <span className="truncate">{lesson.group.name}</span>
                      {lesson.isTrial && (
                        <Badge
                          variant="outline"
                          className="ml-auto h-3.5 shrink-0 px-1 text-[9px]"
                        >
                          проб
                        </Badge>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
