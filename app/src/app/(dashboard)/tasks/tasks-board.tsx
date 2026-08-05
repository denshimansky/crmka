"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react"
import { TaskList, type TaskRow } from "./task-list"
import { cn } from "@/lib/utils"

type Tab = "active" | "today" | "overdue" | "completed"

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
  const [tab, setTab] = useState<Tab>("active")

  // dueDate и today — строки «YYYY-MM-DD», сравниваются лексикографически как даты.
  const activeTasks = tasks.filter((t) => t.status === "pending")
  const todayTasks = activeTasks.filter((t) => t.dueDate === today)
  const overdueTasks = activeTasks.filter((t) => t.dueDate < today)
  const completedTasks = tasks.filter((t) => t.status === "completed")

  const counts = {
    active: activeTasks.length,
    today: todayTasks.length,
    overdue: overdueTasks.length,
    completed: completedTasks.length,
  }

  const visible =
    tab === "today" ? todayTasks
    : tab === "overdue" ? overdueTasks
    : tab === "completed" ? completedTasks
    : activeTasks

  const cards = [
    { key: "today" as const, title: "На сегодня", value: counts.today, icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
    { key: "overdue" as const, title: "Просрочено", value: counts.overdue, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    { key: "completed" as const, title: "Выполнено", value: counts.completed, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
  ]

  const tabs = [
    { key: "active" as const, label: "Активные", count: counts.active },
    { key: "today" as const, label: "На сегодня", count: counts.today },
    { key: "overdue" as const, label: "Просроченные", count: counts.overdue },
    { key: "completed" as const, label: "Выполненные", count: counts.completed },
  ]

  const emptyLabel =
    tab === "today" ? "Нет задач на сегодня"
    : tab === "overdue" ? "Нет просроченных задач"
    : tab === "completed" ? "Нет выполненных задач"
    : "Нет активных задач"

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
