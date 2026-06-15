"use client"

import { useState, useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight as ChevronRightArrow, RefreshCw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export interface MetricRow {
  id: string
  label: string
  total: number
  conversion: number | null
  perDay: number[]
}

export interface TabData {
  days: string[] // ["04/05", "05/05", ...]
  metrics: MetricRow[]
}

interface FilterOptions {
  branches: { id: string; name: string }[]
  directions: { id: string; name: string }[]
  channels: { id: string; name: string }[]
  employees: { id: string; name: string }[]
}

interface ConversionByDaysTableProps {
  withTrial: TabData
  withoutTrial: TabData
  mode: "month" | "range"
  year: number
  month: number
  from: string
  to: string
  channelId: string
  responsibleId: string
  directionId: string
  branchId: string
  periodLabel: string
  filterOptions: FilterOptions
}

const ALL_VALUE = "__all__"

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function fmt(n: number): string {
  if (n === 0) return ""
  return new Intl.NumberFormat("ru-RU").format(n)
}

export function ConversionByDaysTable({
  withTrial,
  withoutTrial,
  mode,
  year,
  month,
  from,
  to,
  channelId,
  responsibleId,
  directionId,
  branchId,
  periodLabel,
  filterOptions,
}: ConversionByDaysTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)
  const [activeTab, setActiveTab] = useState<"withTrial" | "withoutTrial">("withTrial")

  const data = activeTab === "withTrial" ? withTrial : withoutTrial

  function updateParam(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key)
      else params.set(key, value)
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`)
    })
  }

  function shiftMonth(delta: number) {
    let y = year
    let m = month + delta
    while (m < 1) { m += 12; y -= 1 }
    while (m > 12) { m -= 12; y += 1 }
    updateParam({ year: String(y), month: String(m), from: null, to: null })
  }

  function goCurrentMonth() {
    const now = new Date()
    updateParam({
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      from: null,
      to: null,
    })
  }

  function onModeChange(value: string) {
    if (value === "range") {
      const f = new Date(Date.UTC(year, month - 1, 1))
      const t = new Date(Date.UTC(year, month, 0))
      const toIso = (d: Date) => d.toISOString().slice(0, 10)
      updateParam({ mode: "range", from: toIso(f), to: toIso(t) })
    } else {
      updateParam({ mode: null, from: null, to: null })
    }
  }

  function onApplyRange() {
    updateParam({ from: fromInput || null, to: toInput || null })
  }

  const isCurrentMonth = (() => {
    const now = new Date()
    return year === now.getFullYear() && month === now.getMonth() + 1
  })()

  const hasFilters = !!(channelId || responsibleId || directionId || branchId)

  return (
    <div className="space-y-3">
      {/* Период */}
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={mode} onValueChange={onModeChange}>
          <TabsList>
            <TabsTrigger value="month">Месяц</TabsTrigger>
            <TabsTrigger value="range">Произвольный</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "month" ? (
          <div className="flex items-end gap-2">
            <Button variant="outline" size="icon-xs" onClick={() => shiftMonth(-1)}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <button
              type="button"
              onClick={goCurrentMonth}
              className={`min-w-[160px] rounded-md border px-3 py-1 text-sm font-medium ${
                isCurrentMonth ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {MONTH_NAMES[month - 1]} {year}
            </button>
            <Button variant="outline" size="icon-xs" onClick={() => shiftMonth(1)}>
              <ChevronRightArrow className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">С</Label>
              <Input id="from" type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs">По</Label>
              <Input id="to" type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className="w-[160px]" />
            </div>
            <Button onClick={onApplyRange}>
              <RefreshCw className="mr-2 size-4" />
              Обновить
            </Button>
          </div>
        )}
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Канал</Label>
          <Select
            value={channelId || ALL_VALUE}
            onValueChange={(v) => updateParam({ channelId: v && v !== ALL_VALUE ? v : null })}
          >
            <SelectTrigger className="w-[200px]">
              {channelId
                ? filterOptions.channels.find((c) => c.id === channelId)?.name || "—"
                : "Все каналы"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все каналы</SelectItem>
              {filterOptions.channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ответственный</Label>
          <Select
            value={responsibleId || ALL_VALUE}
            onValueChange={(v) => updateParam({ responsibleId: v && v !== ALL_VALUE ? v : null })}
          >
            <SelectTrigger className="w-[220px]">
              {responsibleId
                ? filterOptions.employees.find((e) => e.id === responsibleId)?.name || "—"
                : "Все"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все</SelectItem>
              {filterOptions.employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Направление</Label>
          <Select
            value={directionId || ALL_VALUE}
            onValueChange={(v) => updateParam({ directionId: v && v !== ALL_VALUE ? v : null })}
          >
            <SelectTrigger className="w-[200px]">
              {directionId
                ? filterOptions.directions.find((d) => d.id === directionId)?.name || "—"
                : "Все направления"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все направления</SelectItem>
              {filterOptions.directions.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Филиал</Label>
          <Select
            value={branchId || ALL_VALUE}
            onValueChange={(v) => updateParam({ branchId: v && v !== ALL_VALUE ? v : null })}
          >
            <SelectTrigger className="w-[200px]">
              {branchId
                ? filterOptions.branches.find((b) => b.id === branchId)?.name || "—"
                : "Все филиалы"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все филиалы</SelectItem>
              {filterOptions.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() =>
              updateParam({
                channelId: null,
                responsibleId: null,
                directionId: null,
                branchId: null,
              })
            }
          >
            Сбросить фильтры
          </Button>
        )}
      </div>

      {/* Вкладки: с пробным / без пробного */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "withTrial" | "withoutTrial")}>
        <TabsList>
          <TabsTrigger value="withTrial">С пробным</TabsTrigger>
          <TabsTrigger value="withoutTrial">Без пробного</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Таблица */}
      {data.days.length === 0 ? (
        <div className="flex items-center justify-center rounded-md border p-12 text-muted-foreground">
          За выбранный период нет данных
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">
                  Показатель
                </th>
                <th className="px-2 py-2 text-center font-medium whitespace-nowrap">Итого</th>
                <th className="px-2 py-2 text-center font-medium whitespace-nowrap">Конверсия</th>
                {data.days.map((d) => (
                  <th
                    key={d}
                    className="px-1 py-2 text-center font-normal text-xs text-muted-foreground whitespace-nowrap"
                  >
                    {d}
                  </th>
                ))}
              </tr>
              <tr className="bg-muted/30">
                <th
                  className="sticky left-0 z-10 bg-muted/30 px-3 py-1 text-left text-xs font-normal text-muted-foreground"
                  colSpan={3 + data.days.length}
                >
                  {periodLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m, idx) => (
                <tr key={m.id} className="border-t">
                  <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">
                    {idx + 1}. {m.label}
                  </td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums">{fmt(m.total)}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-muted-foreground">
                    {m.conversion === null ? "" : `${m.conversion}%`}
                  </td>
                  {m.perDay.map((v, i) => (
                    <td key={i} className="px-1 py-1.5 text-center tabular-nums">
                      {fmt(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
