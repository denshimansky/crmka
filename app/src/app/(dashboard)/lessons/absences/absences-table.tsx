"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RefreshCw } from "lucide-react"
import type { AbsenceGroupRow } from "./page"

const ALL_VALUE = "__all__"

interface FilterOption {
  id: string
  name: string
}

interface AbsencesViewProps {
  rows: AbsenceGroupRow[]
  noShowCount: number
  unmarkedCount: number
  tab: "noshow" | "unmarked"
  from: string
  to: string
  branchId: string
  roomId: string
  directionId: string
  instructorId: string
  filterOptions: {
    branches: FilterOption[]
    rooms: { id: string; name: string; branchId: string }[]
    directions: FilterOption[]
    instructors: { id: string; name: string }[]
  }
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`
}

function formatMoney(value: number | null): string {
  if (value === null) return ""
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function AbsencesView({
  rows,
  noShowCount,
  unmarkedCount,
  tab,
  from,
  to,
  branchId,
  roomId,
  directionId,
  instructorId,
  filterOptions,
}: AbsencesViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)

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

  const onApplyPeriod = () => {
    updateParam({ from: fromInput || null, to: toInput || null })
  }

  const onTabChange = (value: string) => {
    updateParam({ tab: value === "noshow" ? null : value })
  }

  const visibleRooms = useMemo(() => {
    if (!branchId) return filterOptions.rooms
    return filterOptions.rooms.filter((r) => r.branchId === branchId)
  }, [branchId, filterOptions.rooms])

  const totalDetails = rows.reduce((acc, g) => acc + g.details.length, 0)

  return (
    <div className="space-y-4">
      {/* Период */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs">С</Label>
          <Input
            id="from"
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-xs">По</Label>
          <Input
            id="to"
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <Button onClick={onApplyPeriod} disabled={pending} variant="default">
          <RefreshCw className="mr-2 size-4" />
          Обновить
        </Button>
      </div>

      {/* Вкладки */}
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="noshow">
            Только неявки <span className="ml-1 text-muted-foreground">({noShowCount})</span>
          </TabsTrigger>
          <TabsTrigger value="unmarked">
            Все отклонения <span className="ml-1 text-muted-foreground">({unmarkedCount})</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Фильтры */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Филиал</Label>
          <Select
            value={branchId || ALL_VALUE}
            onValueChange={(v) =>
              updateParam({
                branchId: v === ALL_VALUE ? null : v,
                roomId: null, // сбрасываем кабинет, т.к. он привязан к филиалу
              })
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Все" />
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
              <SelectValue placeholder="Все" />
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
            onValueChange={(v) => updateParam({ directionId: v === ALL_VALUE ? null : v })}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Все" />
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
            onValueChange={(v) => updateParam({ instructorId: v === ALL_VALUE ? null : v })}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Все" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все педагоги</SelectItem>
              {filterOptions.instructors.map((i) => (
                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(branchId || roomId || directionId || instructorId) && (
          <Button
            variant="ghost"
            onClick={() =>
              updateParam({
                branchId: null,
                roomId: null,
                directionId: null,
                instructorId: null,
              })
            }
          >
            Сбросить
          </Button>
        )}
      </div>

      {/* Таблица */}
      {rows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead>ФИО</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Сегмент</TableHead>
                <TableHead>Педагог</TableHead>
                <TableHead className="text-center">Кол.занятий</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Вид дня</TableHead>
                <TableHead className="text-right">Баланс</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((group) =>
                group.details.map((d, idx) => (
                  <TableRow
                    key={`${group.key}-${idx}`}
                    className={idx === 0 ? "border-t-2" : ""}
                  >
                    {idx === 0 ? (
                      <>
                        <TableCell rowSpan={group.details.length} className="align-top font-medium">
                          {group.branchName}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top">
                          {group.clientLabel}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top text-muted-foreground">
                          {group.directionName}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top text-muted-foreground">
                          {group.segmentLabel}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top text-muted-foreground">
                          {group.instructorName}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top text-center">
                          {group.details.length}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell className="whitespace-nowrap">{formatDate(d.date)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.attendanceTypeName || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.balance !== null ? formatMoney(d.balance) : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.comment || ""}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Учеников: {rows.length} · Занятий: {totalDetails}
        </p>
      )}
    </div>
  )
}
