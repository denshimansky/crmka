"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react"
import { TaskList, type TaskRow } from "./task-list"
import { cn } from "@/lib/utils"

type Tab = "current" | "overdue" | "completed"

export function TasksBoard({
  tasks,
  today,
  canDelete,
  canViewClients,
}: {
  tasks: TaskRow[]
  /** Сегодняшняя дата (YYYY-MM-DD, календарь сервера) — граница «сегодня/просрочено». */
  today: string
  canDelete: boolean
  canViewClients: boolean
}) {
  const [tab, setTab] = useState<Tab>("current")

  // dueDate и today — строки «YYYY-MM-DD», сравниваются лексикографически как даты.
  // «Актуальные» = все невыполненные задачи (объединили бывшие «Активные» и «На
  // сегодня» — «сегодня» было подмножеством «активных»). Просроченные внутри идут
  // первыми: список приходит отсортированным по сроку (dueDate asc). Отдельная
  // вкладка «Просроченные» — фокус на тех, у кого срок уже прошёл (dueDate < today).
  const currentTasks = tasks.filter((t) => t.status === "pending")
  const overdueTasks = currentTasks.filter((t) => t.dueDate < today)
  const completedTasks = tasks.filter((t) => t.status === "completed")

  const counts = {
    current: currentTasks.length,
    overdue: overdueTasks.length,
    completed: completedTasks.length,
  }

  const visible =
    tab === "overdue" ? overdueTasks
    : tab === "completed" ? completedTasks
    : currentTasks

  const cards = [
    { key: "current" as const, title: "Актуальные", value: counts.current, icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
    { key: "overdue" as const, title: "Просрочено", value: counts.overdue, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    { key: "completed" as const, title: "Выполнено", value: counts.completed, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
  ]

  const tabs = [
    { key: "current" as const, label: "Актуальные", count: counts.current },
    { key: "overdue" as const, label: "Просроченные", count: counts.overdue },
    { key: "completed" as const, label: "Выполненные", count: counts.completed },
  ]

  const emptyLabel =
    tab === "overdue" ? "Нет просроченных задач"
    : tab === "completed" ? "Нет выполненных задач"
    : "Нет актуальных задач"

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <button key={c.key} type="button" onClick={() => setTab(c.key)} className="text-left" aria-pressed={tab === c.key}>
              <Card className={cn("transition-colors hover:bg-muted/40", tab === c.key && "ring-2 ring-primary")}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className={`flex size-10 items-center justify-center rounded-lg ${c.bg}`}>
                    <Icon className={`size-5 ${c.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{c.title}</p>
                    <p className="text-2xl font-bold">{c.value}</p>
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      <div>
        <div className="flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="rounded-b-md border border-t-0">
          <TaskList
            tasks={visible}
            canDelete={canDelete}
            canViewClients={canViewClients}
            showCompletedColumns={tab === "completed"}
            emptyLabel={emptyLabel}
          />
        </div>
      </div>
    </div>
  )
}
