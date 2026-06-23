"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { AttendanceRow, AttendanceTypeOption, AttendanceCellData } from "./page"

const ALL_VALUE = "__all__"

interface FilterOption {
  id: string
  name: string
}

interface DayHeader {
  day: number
  dow: string
  isWeekend: boolean
}

interface AttendanceGridProps {
  rows: AttendanceRow[]
  dayHeaders: DayHeader[]
  branchId: string
  roomId: string
  directionId: string
  instructorId: string
  groupId: string
  filterOptions: {
    branches: FilterOption[]
    rooms: { id: string; name: string; branchId: string }[]
    directions: FilterOption[]
    instructors: { id: string; name: string }[]
    groups: { id: string; name: string; branchId: string; directionId: string; instructorId: string }[]
  }
  typeOptions: AttendanceTypeOption[]
}

// Стили ячейки по коду статуса
function cellClassName(cell: AttendanceCellData | null): string {
  if (!cell) return "bg-muted/40"
  // Пробное: фиолетовый = запланировано, зелёный = пришёл, красный = не пришёл.
  if (cell.isTrial) {
    switch (cell.trialStatus) {
      case "attended":
        return "bg-green-200 hover:bg-green-300 text-green-900"
      case "no_show":
        return "bg-red-200 hover:bg-red-300 text-red-900"
      default:
        return "bg-violet-200 hover:bg-violet-300 text-violet-900"
    }
  }
  if (cell.isPending) return "bg-yellow-100 hover:bg-yellow-200"
  switch (cell.attendanceTypeCode) {
    case "present":
      return "bg-green-200 hover:bg-green-300 text-green-900"
    case "no_show":
      return "bg-red-200 hover:bg-red-300 text-red-900"
    case "excused":
      return "bg-sky-200 hover:bg-sky-300 text-sky-900"
    case "absent":
      return "bg-orange-200 hover:bg-orange-300 text-orange-900"
    case "recalculation":
      return "bg-slate-200 hover:bg-slate-300 text-slate-900"
    case "makeup":
      return "bg-emerald-200 hover:bg-emerald-300 text-emerald-900"
    case "makeup_scheduled":
      return "bg-purple-200 hover:bg-purple-300 text-purple-900"
    default:
      // Есть занятие, но статус не выставлен (план)
      return "bg-yellow-100 hover:bg-yellow-200"
  }
}

function cellShort(cell: AttendanceCellData | null): string {
  if (!cell) return ""
  // Пробное: запланировано = пустая фиолетовая ячейка (как «план» у обычных),
  // Б = пришёл, Нб = не пришёл.
  if (cell.isTrial) {
    switch (cell.trialStatus) {
      case "attended": return "Б"
      case "no_show": return "Нб"
      default: return ""
    }
  }
  if (cell.isPending || !cell.attendanceTypeCode) return ""
  switch (cell.attendanceTypeCode) {
    case "present": return "Б"
    case "no_show": return "Нб"
    case "excused": return "У"
    case "absent": return "П"
    case "recalculation": return "Р"
    case "makeup": return "О"
    case "makeup_scheduled": return "↻"
    default: return ""
  }
}

function formatBirthDate(iso: string | null): string {
  if (!iso) return ""
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`
}

function formatMoney(n: number | null): string {
  if (n === null) return ""
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)
}

export function AttendanceGrid({
  rows,
  dayHeaders,
  branchId,
  roomId,
  directionId,
  instructorId,
  groupId,
  filterOptions,
  typeOptions,
}: AttendanceGridProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [marking, setMarking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateParam = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key)
      else params.set(key, value)
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`)
    })
  }

  const visibleRooms = useMemo(() => {
    if (!branchId) return filterOptions.rooms
    return filterOptions.rooms.filter((r) => r.branchId === branchId)
  }, [branchId, filterOptions.rooms])

  const visibleGroups = useMemo(() => {
    let g = filterOptions.groups
    if (branchId) g = g.filter((x) => x.branchId === branchId)
    if (directionId) g = g.filter((x) => x.directionId === directionId)
    if (instructorId) g = g.filter((x) => x.instructorId === instructorId)
    return g
  }, [branchId, directionId, instructorId, filterOptions.groups])

  async function markCell(
    cellKey: string,
    lessonId: string,
    clientId: string,
    wardId: string | null,
    typeId: string | null,
    attendanceId: string | null,
  ) {
    setError(null)
    setMarking(cellKey)
    try {
      let res: Response
      if (typeId === null) {
        // Сброс отметки
        res = await fetch(`/api/lessons/${lessonId}/attendance`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            attendanceId
              ? { attendanceId }
              : { clientId, wardId: wardId ?? null },
          ),
        })
      } else {
        res = await fetch(`/api/lessons/${lessonId}/attendance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            wardId: wardId ?? null,
            subscriptionId: null,
            attendanceTypeId: typeId,
            instructorPayEnabled: true,
            scheduledMakeupLessonId: null,
          }),
        })
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || "Не удалось обновить отметку")
        return
      }
      router.refresh()
    } catch {
      setError("Сеть недоступна. Повторите попытку.")
    } finally {
      setMarking(null)
    }
  }

  // Отметка пробного — отдельный эндпоинт: статус пробного ведёт побочные эффекты
  // (Attendance с isTrial, этап заявки, ЗП педагога). Обычная отметка тут не годится.
  async function markTrial(
    cellKey: string,
    trialId: string,
    status: "scheduled" | "attended" | "no_show",
  ) {
    setError(null)
    setMarking(cellKey)
    try {
      const res = await fetch(`/api/trial-lessons/${trialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || "Не удалось обновить пробное")
        return
      }
      router.refresh()
    } catch {
      setError("Сеть недоступна. Повторите попытку.")
    } finally {
      setMarking(null)
    }
  }

  const noTypesAvailable = typeOptions.length === 0

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Филиал</Label>
          <Select
            value={branchId || ALL_VALUE}
            onValueChange={(v) =>
              updateParam({
                branchId: v === ALL_VALUE ? null : v,
                roomId: null,
                groupId: null,
              })
            }
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

        <div className="space-y-1">
          <Label className="text-xs">Кабинет</Label>
          <Select
            value={roomId || ALL_VALUE}
            onValueChange={(v) => updateParam({ roomId: v === ALL_VALUE ? null : v })}
          >
            <SelectTrigger className="w-[200px]">
              {roomId
                ? visibleRooms.find((r) => r.id === roomId)?.name || "—"
                : "Все кабинеты"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все кабинеты</SelectItem>
              {visibleRooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Направление</Label>
          <Select
            value={directionId || ALL_VALUE}
            onValueChange={(v) =>
              updateParam({
                directionId: v === ALL_VALUE ? null : v,
                groupId: null,
              })
            }
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
          <Label className="text-xs">Педагог</Label>
          <Select
            value={instructorId || ALL_VALUE}
            onValueChange={(v) =>
              updateParam({
                instructorId: v === ALL_VALUE ? null : v,
                groupId: null,
              })
            }
          >
            <SelectTrigger className="w-[220px]">
              {instructorId
                ? filterOptions.instructors.find((i) => i.id === instructorId)?.name || "—"
                : "Все педагоги"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все педагоги</SelectItem>
              {filterOptions.instructors.map((i) => (
                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Группа</Label>
          <Select
            value={groupId || ALL_VALUE}
            onValueChange={(v) => updateParam({ groupId: v === ALL_VALUE ? null : v })}
          >
            <SelectTrigger className="w-[240px]">
              {groupId
                ? visibleGroups.find((g) => g.id === groupId)?.name || "—"
                : "Все группы"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все группы</SelectItem>
              {visibleGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(branchId || roomId || directionId || instructorId || groupId) && (
          <Button
            variant="ghost"
            onClick={() =>
              updateParam({
                branchId: null,
                roomId: null,
                directionId: null,
                instructorId: null,
                groupId: null,
              })
            }
          >
            Сбросить
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Таблица */}
      {rows.length === 0 ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Нет зачисленных учеников по выбранным фильтрам и периоду.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">
                  Контрагент
                </th>
                <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Дата рожд.</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">К оплате</th>
                <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Группа</th>
                <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Педагог</th>
                <th className="px-2 py-2 text-center font-medium whitespace-nowrap">План</th>
                {dayHeaders.map((dh) => (
                  <th
                    key={dh.day}
                    className={`px-1 py-1 text-center font-normal text-xs ${dh.isWeekend ? "text-red-500" : "text-muted-foreground"}`}
                  >
                    <div>{dh.day}</div>
                    <div>{dh.dow}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t hover:bg-muted/20">
                  <td className="sticky left-0 z-10 bg-background px-3 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{row.contragentLabel}</span>
                      {row.isTrial && (
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                          пробное
                        </span>
                      )}
                    </div>
                    {row.parentLabel && (
                      <div className="text-xs text-muted-foreground">{row.parentLabel}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                    {formatBirthDate(row.birthDate)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-red-600">
                    {formatMoney(row.toPayAmount)}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{row.groupName}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                    {row.instructorLabel}
                  </td>
                  <td className="px-2 py-1.5 text-center">{row.planCount}</td>
                  {row.cells.map((cell, idx) => {
                    const cellKey = `${row.key}-${idx}`
                    if (!cell) {
                      return (
                        <td
                          key={cellKey}
                          className="border-l bg-muted/40 px-0 py-0"
                          style={{ width: 28, minWidth: 28 }}
                        />
                      )
                    }
                    const isMarking = marking === cellKey
                    return (
                      <td
                        key={cellKey}
                        className="border-l p-0"
                        style={{ width: 28, minWidth: 28 }}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={isMarking || (!cell.isTrial && noTypesAvailable)}
                            className={`flex h-7 w-full items-center justify-center text-xs font-medium transition-colors ${cellClassName(cell)} ${isMarking ? "opacity-50" : ""}`}
                            title={
                              cell.isTrial
                                ? cell.trialStatus === "attended"
                                  ? "Пробное — пришёл"
                                  : cell.trialStatus === "no_show"
                                    ? "Пробное — не пришёл"
                                    : "Пробное — запланировано"
                                : cell.attendanceTypeName || (cell.isPending ? "Ожидание отметки" : "Не отмечен")
                            }
                          >
                            {cellShort(cell)}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="min-w-[180px]">
                            {cell.isTrial ? (
                              <>
                                <DropdownMenuItem
                                  disabled={cell.trialStatus === "scheduled"}
                                  onClick={() => markTrial(cellKey, cell.trialId!, "scheduled")}
                                  className="text-muted-foreground"
                                >
                                  Не отмечен
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => markTrial(cellKey, cell.trialId!, "attended")}>
                                  Был (пробное)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => markTrial(cellKey, cell.trialId!, "no_show")}>
                                  Не пришёл
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  disabled={!cell.attendanceId}
                                  onClick={() =>
                                    markCell(
                                      cellKey,
                                      cell.lessonId,
                                      row.clientId,
                                      row.wardId,
                                      null,
                                      cell.attendanceId,
                                    )
                                  }
                                  className="text-muted-foreground"
                                >
                                  Не отмечен
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {typeOptions.map((t) => (
                                  <DropdownMenuItem
                                    key={t.id}
                                    onClick={() =>
                                      markCell(
                                        cellKey,
                                        cell.lessonId,
                                        row.clientId,
                                        row.wardId,
                                        t.id,
                                        cell.attendanceId,
                                      )
                                    }
                                  >
                                    {t.name}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
