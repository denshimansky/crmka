"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"

/**
 * Общий каркас для отчётов-страниц, которые берут данные из готовых
 * API-роутов `/api/reports/*` (контракт: `{ data, metadata }`, период через
 * `dateFrom`/`dateTo`). Серверные отчёты (читающие БД напрямую) этот каркас
 * не используют — он только для клиентских страниц поверх API.
 */

export interface ReportData<T = Record<string, unknown>> {
  loading: boolean
  error: string | null
  data: T[]
  metadata: Record<string, unknown> | null
  year: number
  month: number
}

/**
 * Тянет отчёт из API по выбранному в URL месяцу (MonthPicker кладёт year/month).
 * extraParams — дополнительные query-параметры (groupBy, branchId и т.п.).
 */
export function useReportData<T = Record<string, unknown>>(
  endpoint: string,
  extraParams?: Record<string, string | undefined>,
): ReportData<T> {
  const sp = useSearchParams()
  const now = new Date()
  const year = Number(sp.get("year")) || now.getFullYear()
  const month = Number(sp.get("month")) || now.getMonth() + 1

  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    data: T[]
    metadata: Record<string, unknown> | null
  }>({ loading: true, error: null, data: [], metadata: null })

  const extraKey = JSON.stringify(extraParams || {})

  useEffect(() => {
    const dateFrom = new Date(Date.UTC(year, month - 1, 1)).toISOString()
    const dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString()
    const params = new URLSearchParams({ dateFrom, dateTo })
    const extra = JSON.parse(extraKey) as Record<string, string | undefined>
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v)

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(`${endpoint}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Не удалось загрузить отчёт"))))
      .then((json) => {
        if (cancelled) return
        setState({ loading: false, error: null, data: json.data || [], metadata: json.metadata || null })
      })
      .catch((e: Error) => {
        if (cancelled) return
        setState({ loading: false, error: e.message, data: [], metadata: null })
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, year, month, extraKey])

  return { ...state, year, month }
}

/** Шапка отчёта: «назад», заголовок + справка, MonthPicker, слот действий. */
export function ReportShell({
  title,
  subtitle,
  pageKey,
  period = true,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  pageKey: string
  /** Показывать MonthPicker (для снимков «на сегодня» — false). */
  period?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            <PageHelp pageKey={pageKey} />
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {period && <MonthPicker />}
        {actions}
      </div>
      {children}
    </div>
  )
}

/** Единые состояния загрузки/ошибки/пустоты для тела отчёта. */
export function ReportStatus({
  loading,
  error,
  empty,
  emptyText = "За выбранный период данных нет",
}: {
  loading: boolean
  error: string | null
  empty: boolean
  emptyText?: string
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Загрузка…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
    )
  }
  if (empty) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{emptyText}</p>
  }
  return null
}

export function fmtMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", weekday: "short" })
}
