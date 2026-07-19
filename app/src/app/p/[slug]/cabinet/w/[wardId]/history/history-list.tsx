"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { History, BookOpen, Star, CheckCircle2, XCircle } from "lucide-react"

// История подопечного: абонементы и пробные занятия (лёгкая лента, без денег).

type Event = {
  id: string
  date: string
  kind:
    | "subscription_created"
    | "subscription_closed"
    | "subscription_withdrawn"
    | "trial_scheduled"
    | "trial_attended"
  title: string
  detail: string | null
}

const KIND_ICON: Record<Event["kind"], typeof BookOpen> = {
  subscription_created: BookOpen,
  subscription_closed: CheckCircle2,
  subscription_withdrawn: XCircle,
  trial_scheduled: Star,
  trial_attended: CheckCircle2,
}

export function HistoryList({ wardId }: { wardId: string }) {
  const [items, setItems] = useState<Event[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setItems(null)
    fetch(`/api/portal/wards/${wardId}/timeline`)
      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить историю")
        return r.json()
      })
      .then((json) => setItems(json.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
  }, [wardId])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <History className="size-4" />
          История
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="py-4 text-center text-sm text-destructive">{error}</p>}
        {!error && items === null && (
          <p className="py-4 text-center text-sm text-muted-foreground">Загрузка…</p>
        )}
        {items !== null && items.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Событий пока нет</p>
        )}
        <div className="space-y-2">
          {(items || []).map((event) => {
            const Icon = KIND_ICON[event.kind] || BookOpen
            return (
              <div key={event.id} className="flex items-start gap-3 rounded-md border p-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{event.title}</div>
                  {event.detail && (
                    <div className="text-xs text-muted-foreground">{event.detail}</div>
                  )}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {new Date(event.date).toLocaleDateString("ru")}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
