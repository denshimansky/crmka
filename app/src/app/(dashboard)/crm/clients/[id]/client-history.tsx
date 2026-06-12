"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  StickyNote,
  Phone,
  CalendarDays,
  GraduationCap,
  X,
  CircleCheck,
  CreditCard,
  RotateCcw,
  CalendarClock,
  Tag,
  History,
} from "lucide-react"

interface TimelineEvent {
  id: string
  kind: string
  date: string
  title: string
  description?: string | null
  meta?: Record<string, unknown>
}

interface FilterDef {
  key: string
  label: string
  kinds: string[]
}

const FILTERS: FilterDef[] = [
  { key: "comm", label: "Коммуникации", kinds: ["communication"] },
  { key: "trial", label: "Пробные", kinds: ["trial_scheduled", "trial_attended", "trial_no_show"] },
  { key: "sub", label: "Абонементы", kinds: ["subscription_created", "subscription_closed"] },
  { key: "pay", label: "Оплаты", kinds: ["payment_in", "payment_refund", "subscription_paid_from_balance", "balance_credit", "balance_debit"] },
  { key: "att", label: "Посещения", kinds: ["attendance_present", "attendance_absent", "attendance_other"] },
  { key: "status", label: "Статусы", kinds: ["status_change"] },
  { key: "discount", label: "Скидки", kinds: ["template_discount_removed"] },
]

// Фильтры, недоступные в режиме «история ребёнка» — оплаты/коммуникации/статусы
// клиента общие на семью, к конкретному ребёнку не относятся.
const WARD_HIDDEN_FILTERS = new Set(["comm", "pay", "status"])

const KIND_CONFIG: Record<
  string,
  { icon: typeof StickyNote; color: string; bg: string }
> = {
  communication: { icon: StickyNote, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  trial_scheduled: { icon: CalendarClock, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
  trial_attended: { icon: GraduationCap, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  trial_no_show: { icon: X, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  subscription_created: { icon: Tag, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/30" },
  subscription_closed: { icon: Tag, color: "text-gray-600", bg: "bg-gray-100 dark:bg-gray-800" },
  payment_in: { icon: CreditCard, color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
  payment_refund: { icon: RotateCcw, color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30" },
  subscription_paid_from_balance: { icon: CreditCard, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/30" },
  balance_credit: { icon: CreditCard, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  balance_debit: { icon: RotateCcw, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  attendance_present: { icon: CircleCheck, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  attendance_absent: { icon: X, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  attendance_other: { icon: CalendarDays, color: "text-gray-600", bg: "bg-gray-100 dark:bg-gray-800" },
  status_change: { icon: History, color: "text-indigo-600", bg: "bg-indigo-100 dark:bg-indigo-900/30" },
  template_discount_removed: { icon: Tag, color: "text-amber-700", bg: "bg-amber-100 dark:bg-amber-900/30" },
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function dateKey(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD
}

function formatDateHeader(key: string): string {
  const d = new Date(key)
  return d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

export function ClientHistory({
  clientId,
  wardId,
}: {
  clientId: string
  /** Если задан — лента фильтруется до событий конкретного ребёнка
   *  (пробные/абонементы/посещения по wardId). */
  wardId?: string
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    comm: true,
    trial: true,
    sub: true,
    pay: true,
    // В ward-режиме посещений мало (только этого ребёнка) — включаем по умолчанию.
    att: !!wardId,
    status: true,
    discount: true,
  })

  const visibleFilters = useMemo(
    () => (wardId ? FILTERS.filter((f) => !WARD_HIDDEN_FILTERS.has(f.key)) : FILTERS),
    [wardId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const url = wardId
      ? `/api/clients/${clientId}/timeline?wardId=${encodeURIComponent(wardId)}`
      : `/api/clients/${clientId}/timeline`
    fetch(url)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) {
          setError(d?.error || "Ошибка загрузки")
        } else {
          setEvents(d.events || [])
        }
      })
      .catch(() => {
        if (!cancelled) setError("Ошибка сети")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, wardId])

  const visible = useMemo(() => {
    const allowedKinds = new Set<string>()
    for (const f of visibleFilters) {
      if (enabled[f.key]) f.kinds.forEach((k) => allowedKinds.add(k))
    }
    return events.filter((e) => allowedKinds.has(e.kind))
  }, [events, enabled, visibleFilters])

  // Группируем по дню
  const groups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>()
    for (const e of visible) {
      const k = dateKey(e.date)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [visible])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            История событий
            <Badge variant="secondary" className="ml-2 font-normal">
              {visible.length}
            </Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {visibleFilters.map((f) => (
              <label
                key={f.key}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs"
              >
                <Checkbox
                  checked={enabled[f.key]}
                  onCheckedChange={(v) =>
                    setEnabled((prev) => ({ ...prev, [f.key]: !!v }))
                  }
                />
                <Label className="cursor-pointer text-xs font-normal">{f.label}</Label>
              </label>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Загрузка...</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {events.length === 0 ? "Событий пока нет" : "Нет событий по выбранным фильтрам"}
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map(([day, list]) => (
              <div key={day}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatDateHeader(day)}
                </h3>
                <ol className="relative space-y-3 border-l-2 border-muted pl-5">
                  {list.map((e) => {
                    const cfg =
                      KIND_CONFIG[e.kind] ||
                      KIND_CONFIG.communication
                    const Icon = cfg.icon
                    const author = (e.meta?.author as string) || undefined
                    return (
                      <li key={e.id} className="relative">
                        <span
                          className={`absolute -left-[34px] flex size-6 items-center justify-center rounded-full ${cfg.bg}`}
                        >
                          <Icon className={`size-3.5 ${cfg.color}`} />
                        </span>
                        <div className="rounded-md border bg-card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{e.title}</p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateTime(e.date).slice(11)}
                            </span>
                          </div>
                          {e.description && (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                              {e.description}
                            </p>
                          )}
                          {author && (
                            <p className="mt-1 text-xs text-muted-foreground/70">
                              {author}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
