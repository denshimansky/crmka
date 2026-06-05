"use client"

import { useState, useTransition, Fragment } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightArrow, RefreshCw } from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface DirectionAgg {
  created: number
  renewed: number
  activeOnEnd: number
}

export interface DirectionRow {
  id: string
  name: string
  created: number
  renewed: number
  activeOnEnd: number
}

export interface ActiveSubsData {
  total: DirectionAgg
  branches: Array<{
    id: string
    name: string
    agg: DirectionAgg
    directions: DirectionRow[]
  }>
}

type ExpandLevel = "branch" | "direction"

const LEVEL_LABELS: Record<ExpandLevel, string> = {
  branch: "Филиал",
  direction: "Направление",
}

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

const ALL_VALUE = "__all__"

interface FilterOptions {
  branches: { id: string; name: string }[]
}

interface ActiveSubsTableProps {
  data: ActiveSubsData
  mode: "month" | "range"
  year: number
  month: number
  from: string
  to: string
  branchId: string
  periodLabel: string
  filterOptions: FilterOptions
}

function fmt(n: number): string {
  if (n === 0) return ""
  return new Intl.NumberFormat("ru-RU").format(n)
}

export function ActiveSubsTable({
  data,
  mode,
  year,
  month,
  from,
  to,
  branchId,
  periodLabel,
  filterOptions,
}: ActiveSubsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [level, setLevel] = useState<ExpandLevel>("direction")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)

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

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onLevelChange(value: string | null) {
    if (value !== "branch" && value !== "direction") return
    setLevel(value)
    setCollapsed(new Set())
  }

  function showDirections(branchId: string): boolean {
    if (level === "branch") return false
    return !collapsed.has(branchId)
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
      // переключение в произвольный диапазон — берём из текущего месяца
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
            <Button variant="outline" size="icon-xs" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
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
            <Button variant="outline" size="icon-xs" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
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
          <Label className="text-xs">Филиал</Label>
          <Select
            value={branchId || ALL_VALUE}
            onValueChange={(v) =>
              updateParam({ branchId: v && v !== ALL_VALUE ? v : null })
            }
          >
            <SelectTrigger className="w-[220px]">
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

        <div className="space-y-1">
          <Label className="text-xs">Разворачивать до</Label>
          <Select value={level} onValueChange={onLevelChange}>
            <SelectTrigger className="w-[200px]">{LEVEL_LABELS[level]}</SelectTrigger>
            <SelectContent>
              <SelectItem value="branch">Филиал</SelectItem>
              <SelectItem value="direction">Направление</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {collapsed.size > 0 && (
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Сбросить сворачивания ({collapsed.size})
          </button>
        )}
      </div>

      {/* Таблица */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Филиал / Направление</TableHead>
              <TableHead className="text-center">Создано за период</TableHead>
              <TableHead className="text-center">Продлённые</TableHead>
              <TableHead className="text-center">Активны на конец периода</TableHead>
            </TableRow>
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs font-normal text-muted-foreground" colSpan={4}>
                {periodLabel}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-emerald-50/70 font-bold dark:bg-emerald-950/30">
              <TableCell>Итого</TableCell>
              <TableCell className="text-center tabular-nums">{fmt(data.total.created)}</TableCell>
              <TableCell className="text-center tabular-nums">{fmt(data.total.renewed)}</TableCell>
              <TableCell className="text-center tabular-nums">{fmt(data.total.activeOnEnd)}</TableCell>
            </TableRow>

            {data.branches.map((branch) => {
              const open = showDirections(branch.id)
              return (
                <Fragment key={branch.id}>
                  <TableRow className="bg-emerald-50/40 font-semibold dark:bg-emerald-950/15">
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggle(branch.id)}
                          disabled={level === "branch"}
                          className="-ml-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                          aria-label={open ? "Свернуть" : "Развернуть"}
                        >
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                        <span>{branch.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{fmt(branch.agg.created)}</TableCell>
                    <TableCell className="text-center tabular-nums">{fmt(branch.agg.renewed)}</TableCell>
                    <TableCell className="text-center tabular-nums">{fmt(branch.agg.activeOnEnd)}</TableCell>
                  </TableRow>

                  {open && branch.directions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="pl-9 text-muted-foreground">{d.name}</TableCell>
                      <TableCell className="text-center tabular-nums">{fmt(d.created)}</TableCell>
                      <TableCell className="text-center tabular-nums">{fmt(d.renewed)}</TableCell>
                      <TableCell className="text-center tabular-nums">{fmt(d.activeOnEnd)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
