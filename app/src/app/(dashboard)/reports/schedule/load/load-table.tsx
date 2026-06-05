"use client"

import { useState, Fragment } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface LoadAgg {
  maxHours: number
  actualHours: number
  percent: number
}

export interface RoomLoad {
  id: string
  name: string
  maxHours: number
  actualHours: number
  percent: number
}

export interface LoadData {
  total: LoadAgg
  branches: Array<{
    id: string
    name: string
    agg: LoadAgg
    rooms: RoomLoad[]
  }>
}

type ExpandLevel = "branch" | "room"

const LEVEL_LABELS: Record<ExpandLevel, string> = {
  branch: "Филиал",
  room: "Кабинет",
}

function formatHours(n: number): string {
  if (n === 0) return ""
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n)
}

function formatPercent(p: number, hasData: boolean): string {
  if (!hasData) return ""
  return `${p}%`
}

interface LoadTableProps {
  data: LoadData
}

export function LoadTable({ data }: LoadTableProps) {
  const [level, setLevel] = useState<ExpandLevel>("room")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onLevelChange(value: string | null) {
    if (value !== "branch" && value !== "room") return
    setLevel(value)
    setCollapsed(new Set())
  }

  function showRooms(branchId: string): boolean {
    if (level === "branch") return false
    return !collapsed.has(branchId)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Разворачивать до</Label>
          <Select value={level} onValueChange={onLevelChange}>
            <SelectTrigger className="w-[220px]">{LEVEL_LABELS[level]}</SelectTrigger>
            <SelectContent>
              <SelectItem value="branch">Филиал</SelectItem>
              <SelectItem value="room">Кабинет</SelectItem>
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Филиал / Кабинет</TableHead>
              <TableHead className="text-center">Максимальное кол-во часов</TableHead>
              <TableHead className="text-center">Фактическое кол-во часов</TableHead>
              <TableHead className="text-right">% загрузки</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.branches.map((branch) => {
              const branchOpen = showRooms(branch.id)
              const hasBranchActual = branch.agg.actualHours > 0
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
                          aria-label={branchOpen ? "Свернуть" : "Развернуть"}
                        >
                          {branchOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                        <span>{branch.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatHours(branch.agg.maxHours)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatHours(branch.agg.actualHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(branch.agg.percent, hasBranchActual)}
                    </TableCell>
                  </TableRow>

                  {branchOpen &&
                    branch.rooms.map((room) => {
                      const hasRoomActual = room.actualHours > 0
                      return (
                        <TableRow key={room.id}>
                          <TableCell className="pl-9 text-emerald-900 dark:text-emerald-200">
                            {room.name}
                          </TableCell>
                          <TableCell className="text-center tabular-nums text-muted-foreground">
                            {formatHours(room.maxHours)}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {formatHours(room.actualHours)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(room.percent, hasRoomActual)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </Fragment>
              )
            })}

            <TableRow className="bg-emerald-50/70 font-bold dark:bg-emerald-950/30">
              <TableCell>Итого</TableCell>
              <TableCell className="text-center tabular-nums">
                {formatHours(data.total.maxHours)}
              </TableCell>
              <TableCell className="text-center tabular-nums">
                {formatHours(data.total.actualHours)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(data.total.percent, data.total.actualHours > 0)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
