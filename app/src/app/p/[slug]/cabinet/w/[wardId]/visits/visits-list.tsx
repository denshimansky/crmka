"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClipboardCheck } from "lucide-react"

// Посещения подопечного: сводка + список карточками, «Показать ещё».

type Visit = {
  id: string
  date: string
  startTime: string
  groupName: string
  directionName: string
  directionColor: string | null
  typeName: string
  typeCode: string
  charges: boolean
  isTrial: boolean
  isMakeup: boolean
  absenceReason: string | null
}

type Data = {
  hasMore: boolean
  summary: { visited: number; missed: number; makeups: number }
  items: Visit[]
}

function statusBadge(v: Visit): { label: string; className: string } {
  if (v.typeCode === "present" || v.typeCode === "makeup") {
    return { label: "Был(а)", className: "bg-green-100 text-green-800" }
  }
  if (v.typeCode === "absent") {
    return { label: "Пропуск", className: "bg-red-100 text-red-800" }
  }
  if (v.typeCode === "excused") {
    return { label: "Пропуск (уваж.)", className: "bg-muted text-muted-foreground" }
  }
  return { label: v.typeName, className: "bg-muted text-muted-foreground" }
}

export function VisitsList({ wardId }: { wardId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [items, setItems] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(
    async (offset: number) => {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/portal/wards/${wardId}/attendances?offset=${offset}`)
        if (!res.ok) throw new Error("Не удалось загрузить посещения")
        const json: Data = await res.json()
        setData(json)
        setItems((prev) => (offset === 0 ? json.items : [...prev, ...json.items]))
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки")
      } finally {
        setLoading(false)
      }
    },
    [wardId]
  )

  useEffect(() => {
    setItems([])
    load(0)
  }, [load])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ClipboardCheck className="size-4" />
          Посещения
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border p-2">
              <div className="text-lg font-bold text-green-600">{data.summary.visited}</div>
              <div className="text-xs text-muted-foreground">Посещено</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-lg font-bold text-red-600">{data.summary.missed}</div>
              <div className="text-xs text-muted-foreground">Пропуски</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-lg font-bold">{data.summary.makeups}</div>
              <div className="text-xs text-muted-foreground">Отработки</div>
            </div>
          </div>
        )}

        {error && <p className="text-center text-sm text-destructive">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Посещений пока нет</p>
        )}

        <div className="space-y-2">
          {items.map((v) => {
            const badge = statusBadge(v)
            return (
              <div key={v.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {new Date(v.date).toLocaleDateString("ru")} · {v.startTime}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>
                    {v.directionName} · {v.groupName}
                  </span>
                  {v.isMakeup && <Badge variant="secondary">Отработка</Badge>}
                  {v.isTrial && <Badge variant="secondary">Пробное</Badge>}
                </div>
                {v.absenceReason && (
                  <div className="mt-1 text-xs text-muted-foreground">Причина: {v.absenceReason}</div>
                )}
              </div>
            )
          })}
        </div>

        {loading && <p className="py-2 text-center text-sm text-muted-foreground">Загрузка…</p>}
        {data?.hasMore && !loading && (
          <Button variant="outline" className="w-full" onClick={() => load(items.length)}>
            Показать ещё
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
