"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Circle, CheckCircle2, Loader2, AlertCircle } from "lucide-react"

export interface DashboardTaskRow {
  id: string
  title: string
  /** ISO-строка даты события: даты пробного / ДР / занятия и т.п. */
  eventDate: string
  /** Просрочена ли задача (dueDate раньше «сегодня»). */
  isOverdue: boolean
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function DashboardTaskRow({ task }: { task: DashboardTaskRow }) {
  const router = useRouter()
  const [completed, setCompleted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  async function markDone() {
    if (loading || completed) return
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      })
      if (!res.ok) {
        setLoading(false)
        return
      }
      setCompleted(true)
      startTransition(() => router.refresh())
    } catch {
      setLoading(false)
    }
  }

  const baseRowCls =
    "grid grid-cols-[28px_120px_1fr] items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors"
  const overdueCls =
    "border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:hover:bg-red-950/50"
  const normalCls = "hover:bg-muted/40"

  return (
    <div className={`${baseRowCls} ${task.isOverdue ? overdueCls : normalCls}`}>
      <button
        type="button"
        onClick={markDone}
        disabled={loading || completed}
        title={completed ? "Задача выполнена" : "Отметить выполненной"}
        aria-label={completed ? "Задача выполнена" : "Отметить выполненной"}
        className="shrink-0 rounded-full text-muted-foreground hover:text-primary disabled:cursor-default"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : completed ? (
          <CheckCircle2 className="size-4 text-green-600" />
        ) : (
          <Circle className="size-4" />
        )}
      </button>

      <div className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
        {task.isOverdue && (
          <AlertCircle className="size-3.5 text-red-600" aria-hidden="true" />
        )}
        <span
          className={
            task.isOverdue
              ? "font-medium text-red-700 dark:text-red-300"
              : ""
          }
        >
          {fmtDate(task.eventDate)}
        </span>
      </div>

      <span
        className={
          completed
            ? "truncate text-muted-foreground line-through"
            : "truncate"
        }
        title={task.title}
      >
        {task.title}
      </span>
    </div>
  )
}

export function DashboardTasksTable({ tasks }: { tasks: DashboardTaskRow[] }) {
  const sorted = useMemo(() => {
    // Просроченные сверху; внутри групп — по дате события (раньше = выше).
    return [...tasks].sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
      return a.eventDate.localeCompare(b.eventDate)
    })
  }, [tasks])

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет задач</p>
  }

  return (
    <div className="space-y-1.5">
      {sorted.map((t) => (
        <DashboardTaskRow key={t.id} task={t} />
      ))}
    </div>
  )
}
