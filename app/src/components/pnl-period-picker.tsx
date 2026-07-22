"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Suspense } from "react"

// Пикер произвольного периода отчёта: диапазон месяцев «с … по …» (YYYY-MM).
// Кладёт в URL from/to и убирает year/month. Одиночный месяц = from == to.
// Обратная совместимость: если from/to нет, стартуем от year/month (или текущего
// месяца), т.е. старые ссылки ?year=&month= открываются как один месяц.

function ymFromParams(sp: URLSearchParams) {
  const now = new Date()
  const parse = (v: string | null) => {
    if (v && /^\d{4}-\d{2}$/.test(v)) {
      const [y, m] = v.split("-").map(Number)
      if (m >= 1 && m <= 12) return { y, m }
    }
    return null
  }
  const single = {
    y: Number(sp.get("year")) || now.getFullYear(),
    m: Number(sp.get("month")) || now.getMonth() + 1,
  }
  const from = parse(sp.get("from")) ?? single
  const to = parse(sp.get("to")) ?? from
  const fmt = (x: { y: number; m: number }) => `${x.y}-${String(x.m).padStart(2, "0")}`
  return { from: fmt(from), to: fmt(to) }
}

function PnlPeriodPickerInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { from, to } = ymFromParams(searchParams)

  const navigate = (newFrom: string, newTo: string) => {
    const params = new URLSearchParams(searchParams.toString())
    // from/to — единственный источник периода; year/month убираем, чтобы не спорили.
    params.delete("year")
    params.delete("month")
    params.set("from", newFrom)
    params.set("to", newTo)
    router.push(`${pathname}?${params.toString()}`)
  }

  const onFrom = (v: string) => {
    if (!v) return
    // Начало позже конца — подтягиваем конец к началу.
    navigate(v, v > to ? v : to)
  }
  const onTo = (v: string) => {
    if (!v) return
    navigate(v < from ? v : from, v)
  }

  const inputCls =
    "rounded-md border bg-background px-2 py-1 text-sm [color-scheme:light] dark:[color-scheme:dark]"

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Период: с</span>
      <input
        type="month"
        value={from}
        max={to}
        onChange={(e) => onFrom(e.target.value)}
        className={inputCls}
        aria-label="Период с"
      />
      <span className="text-muted-foreground">по</span>
      <input
        type="month"
        value={to}
        min={from}
        onChange={(e) => onTo(e.target.value)}
        className={inputCls}
        aria-label="Период по"
      />
    </div>
  )
}

export function PnlPeriodPicker() {
  return (
    <Suspense fallback={<div className="h-8 w-[280px] animate-pulse rounded-md bg-muted" />}>
      <PnlPeriodPickerInner />
    </Suspense>
  )
}
