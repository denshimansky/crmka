"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Circle, CheckCircle2, Loader2 } from "lucide-react"

interface DashboardTaskItemProps {
  id: string
  title: string
  clientName?: string | null
}

export function DashboardTaskItem({ id, title, clientName }: DashboardTaskItemProps) {
  const router = useRouter()
  const [completed, setCompleted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  async function markDone() {
    if (loading || completed) return
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${id}`, {
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

  return (
    <div className="flex items-center gap-2 text-sm">
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
      <span className={completed ? "text-muted-foreground line-through" : ""}>
        {title}
      </span>
      {clientName && (
        <span className="text-muted-foreground">— {clientName}</span>
      )}
    </div>
  )
}
