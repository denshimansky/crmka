"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RefreshCw, Loader2 } from "lucide-react"
import type { AbsenceGroupRow, AbsenceDetail, EditableAttendanceType } from "./page"

const ALL_VALUE = "__all__"
// Сентинел «Не отмечен» в выпадашке «Вид дня» (Radix Select не принимает "").
const UNMARKED_VALUE = "__unmarked__"

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
  // Типы для инлайн-смены «Вида дня». Пусто для роли «только чтение».
  attendanceTypes: EditableAttendanceType[]
  canEdit: boolean
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
  attendanceTypes,
  canEdit,
}: AbsencesViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)

  // Инлайн-редактирование строк реестра.
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const editable = canEdit && attendanceTypes.length > 0

  // Сменить «Вид дня». typeId=null — сброс отметки (только если она уже есть).
  // POST/DELETE используют тот же эндпоинт и бизнес-логику, что и карточка занятия
  // (списания, ЗП, проверка закрытия периода).
  async function changeType(
    rowKey: string,
    group: AbsenceGroupRow,
    d: AbsenceDetail,
    typeId: string | null,
  ) {
    setEditError(null)
    setSavingKey(rowKey)
    try {
      let res: Response
      if (typeId === null) {
        if (!d.attendanceId) return
        res = await fetch(`/api/lessons/${d.lessonId}/attendance`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendanceId: d.attendanceId }),
        })
      } else {
        res = await fetch(`/api/lessons/${d.lessonId}/attendance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: group.clientId,
            wardId: group.wardId,
            subscriptionId: d.subscriptionId,
            attendanceTypeId: typeId,
            instructorPayEnabled: true,
            scheduledMakeupLessonId: null,
          }),
        })
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEditError(data?.error || "Не удалось обновить отметку")
        return
      }
      router.refresh()
    } catch {
      setEditError("Сеть недоступна. Повторите попытку.")
    } finally {
      setSavingKey(null)
    }
  }

  // Сохранить свободный комментарий. Развязан от отметки (lesson_student_notes),
  // поэтому работает в любом состоянии — в т.ч. на «Неотмеченных», где отметки нет.
  // Пустой текст удаляет заметку (это делает эндпоинт).
  async function saveComment(
    rowKey: string,
    group: AbsenceGroupRow,
    d: AbsenceDetail,
    value: string,
  ) {
    const next = value.trim()
    if (next === (d.comment ?? "").trim()) return // без изменений — не дёргаем сервер
    setEditError(null)
    setSavingKey(rowKey)
    try {
      const res = await fetch(`/api/lessons/${d.lessonId}/absence-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: group.clientId,
          wardId: group.wardId,
          comment: next || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEditError(data?.error || "Не удалось сохранить комментарий")
        return
      }
      router.refresh()
    } catch {
      setEditError("Сеть недоступна. Повторите попытку.")
    } finally {
      setSavingKey(null)
    }
  }

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
            Не был <span className="ml-1 text-muted-foreground">({noShowCount})</span>
          </TabsTrigger>
          <TabsTrigger value="unmarked">
            Неотмеченные посещения <span className="ml-1 text-muted-foreground">({unmarkedCount})</span>
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
            onValueChange={(v) => updateParam({ directionId: v === ALL_VALUE ? null : v })}
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
            onValueChange={(v) => updateParam({ instructorId: v === ALL_VALUE ? null : v })}
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

      {/* Ошибка инлайн-редактирования */}
      {editError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {editError}
        </div>
      )}

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
                group.details.map((d, idx) => {
                  const rowKey = `${group.key}-${idx}`
                  const saving = savingKey === rowKey
                  return (
                  <TableRow
                    key={rowKey}
                    className={idx === 0 ? "border-t-2" : ""}
                  >
                    {idx === 0 ? (
                      <>
                        <TableCell rowSpan={group.details.length} className="align-top font-medium">
                          {group.branchName}
                        </TableCell>
                        <TableCell rowSpan={group.details.length} className="align-top">
                          <Link
                            href={`/crm/clients/${group.clientId}`}
                            className="text-primary hover:underline"
                          >
                            {group.clientLabel}
                          </Link>
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
                    <TableCell>
                      {editable ? (
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={d.attendanceTypeId ?? UNMARKED_VALUE}
                            onValueChange={(v) => {
                              if (saving) return
                              if (v === UNMARKED_VALUE) {
                                if (d.attendanceId) changeType(rowKey, group, d, null)
                                return
                              }
                              if (v === d.attendanceTypeId) return
                              changeType(rowKey, group, d, v)
                            }}
                          >
                            <SelectTrigger className="h-8 w-[170px]" disabled={saving}>
                              {d.attendanceTypeName || (
                                <span className="text-muted-foreground">Не отмечен</span>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNMARKED_VALUE}>
                                <span className="text-muted-foreground">Не отмечен</span>
                              </SelectItem>
                              {attendanceTypes.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{d.attendanceTypeName || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.balance !== null ? formatMoney(d.balance) : ""}
                    </TableCell>
                    <TableCell>
                      {/* Комментарий развязан от отметки и типов — зависит только
                          от права на редактирование (canEdit), не от editable. */}
                      {canEdit ? (
                        <Input
                          key={`${rowKey}-comment-${d.comment ?? ""}`}
                          type="text"
                          defaultValue={d.comment ?? ""}
                          placeholder="Комментарий…"
                          disabled={saving}
                          className="h-8 w-[220px]"
                          onBlur={(e) => saveComment(rowKey, group, d, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur()
                          }}
                        />
                      ) : (
                        <span className="text-muted-foreground">{d.comment || ""}</span>
                      )}
                    </TableCell>
                  </TableRow>
                  )
                }),
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
