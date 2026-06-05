"use client"

import { useState, Fragment } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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

export interface GroupRow {
  id: string
  name: string
  direction: string
  enrolled: number
  onTrial: number
  capacity: number
  free: number
  percent: number
}

export interface AggRow {
  capacity: number
  enrolled: number
  onTrial: number
  free: number
  percent: number
}

export interface CapacityData {
  total: AggRow
  branches: Array<{
    id: string
    name: string
    agg: AggRow
    rooms: Array<{
      id: string
      name: string
      agg: AggRow
      groups: GroupRow[]
    }>
  }>
}

type ExpandLevel = "branch" | "room" | "group"

const LEVEL_LABELS: Record<ExpandLevel, string> = {
  branch: "Филиал",
  room: "Кабинет",
  group: "Группа обучения",
}

interface CapacityTableProps {
  data: CapacityData
}

export function CapacityTable({ data }: CapacityTableProps) {
  // Дефолт = «Группа обучения» (всё раскрыто), как чекбокс в 1С.
  const [level, setLevel] = useState<ExpandLevel>("group")
  // Узлы, которые пользователь явно свернул в текущем режиме.
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
    if (value !== "branch" && value !== "room" && value !== "group") return
    setLevel(value)
    setCollapsed(new Set())
  }

  // Должны ли быть видны дети филиала (кабинеты).
  function showRooms(branchId: string): boolean {
    if (level === "branch") return false
    return !collapsed.has(branchId)
  }
  // Должны ли быть видны дети кабинета (группы).
  function showGroups(roomId: string): boolean {
    if (level !== "group") return false
    return !collapsed.has(roomId)
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
              <SelectItem value="group">Группа обучения</SelectItem>
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
              <TableHead>Филиал / Кабинет / Группа</TableHead>
              <TableHead>Направление</TableHead>
              <TableHead className="text-center">Всего мест</TableHead>
              <TableHead className="text-center">Занято</TableHead>
              <TableHead className="text-center">Записано на пробники</TableHead>
              <TableHead className="text-center">Свободно</TableHead>
              <TableHead className="text-right">% заполнения</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-emerald-50/70 font-bold dark:bg-emerald-950/30">
              <TableCell colSpan={2}>Итого</TableCell>
              <TableCell className="text-center">{data.total.capacity}</TableCell>
              <TableCell className="text-center text-blue-700">
                {data.total.enrolled}
              </TableCell>
              <TableCell className="text-center text-cyan-700">
                {data.total.onTrial || ""}
              </TableCell>
              <TableCell className="text-center text-green-700">
                {data.total.free}
              </TableCell>
              <TableCell className="text-right">{data.total.percent}%</TableCell>
            </TableRow>

            {data.branches.map((branch) => {
              const branchOpen = showRooms(branch.id)
              return (
                <Fragment key={branch.id}>
                  <TableRow className="bg-emerald-50/40 font-semibold dark:bg-emerald-950/15">
                    <TableCell colSpan={2}>
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
                    <TableCell className="text-center">{branch.agg.capacity}</TableCell>
                    <TableCell className="text-center text-blue-700">
                      {branch.agg.enrolled}
                    </TableCell>
                    <TableCell className="text-center text-cyan-700">
                      {branch.agg.onTrial || ""}
                    </TableCell>
                    <TableCell className="text-center text-green-700">
                      {branch.agg.free}
                    </TableCell>
                    <TableCell className="text-right">{branch.agg.percent}%</TableCell>
                  </TableRow>

                  {branchOpen &&
                    branch.rooms.map((room) => {
                      const roomOpen = showGroups(room.id)
                      return (
                        <Fragment key={room.id}>
                          <TableRow className="bg-emerald-50/20 font-medium dark:bg-emerald-950/10">
                            <TableCell colSpan={2} className="pl-8 text-emerald-900 dark:text-emerald-200">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggle(room.id)}
                                  disabled={level !== "group"}
                                  className="-ml-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  aria-label={roomOpen ? "Свернуть" : "Развернуть"}
                                >
                                  {roomOpen ? (
                                    <ChevronDown className="size-4" />
                                  ) : (
                                    <ChevronRight className="size-4" />
                                  )}
                                </button>
                                <span>{room.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">{room.agg.capacity}</TableCell>
                            <TableCell className="text-center">{room.agg.enrolled}</TableCell>
                            <TableCell className="text-center text-cyan-700">
                              {room.agg.onTrial || ""}
                            </TableCell>
                            <TableCell className="text-center text-green-700">
                              {room.agg.free}
                            </TableCell>
                            <TableCell className="text-right">{room.agg.percent}%</TableCell>
                          </TableRow>

                          {roomOpen &&
                            room.groups.map((g) => (
                              <TableRow key={g.id}>
                                <TableCell className="pl-16">
                                  <Link
                                    href={`/schedule/groups/${g.id}`}
                                    className="text-primary hover:underline"
                                  >
                                    {g.name}
                                  </Link>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {g.direction}
                                </TableCell>
                                <TableCell className="text-center text-muted-foreground">
                                  {g.capacity}
                                </TableCell>
                                <TableCell className="text-center">{g.enrolled || ""}</TableCell>
                                <TableCell className="text-center text-cyan-600">
                                  {g.onTrial || ""}
                                </TableCell>
                                <TableCell className="text-center">
                                  <span
                                    className={
                                      g.free > 0
                                        ? "text-green-600"
                                        : "text-red-600 font-medium"
                                    }
                                  >
                                    {g.free}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  {g.enrolled > 0 ? (
                                    <Badge
                                      variant={
                                        g.percent >= 90
                                          ? "destructive"
                                          : g.percent >= 70
                                            ? "default"
                                            : "outline"
                                      }
                                    >
                                      {g.percent}%
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </Fragment>
                      )
                    })}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
