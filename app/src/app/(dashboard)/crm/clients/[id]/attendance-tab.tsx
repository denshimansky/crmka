"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { ClipboardCheck, ExternalLink, X, Sparkles } from "lucide-react"

const MONTH_SHORT = [
  "",
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]

interface AttendanceItem {
  id: string
  lessonId: string
  date: string
  startTime: string
  lessonStatus: string
  isLessonMakeup: boolean
  isTrial: boolean
  isMakeup: boolean
  chargeAmount: number
  markedAt: string | null
  direction: { id: string; name: string }
  group: { id: string; name: string }
  room: string
  instructorName: string
  ward: { id: string; name: string } | null
  attendanceType: {
    id: string
    name: string
    code: string
    chargesSubscription: boolean
    countsAsRevenue: boolean
  }
  absenceReason: string | null
  subscription: { id: string; periodYear: number; periodMonth: number } | null
}

interface Ward {
  id: string
  firstName: string
  lastName: string | null
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

// Цвет бейджа вида занятия по коду типа посещения
function typeBadgeVariant(
  code: string,
  countsAsRevenue: boolean
): "default" | "secondary" | "destructive" | "outline" {
  if (code === "present" || countsAsRevenue) return "default"
  if (
    code === "absent" ||
    code === "sick" ||
    code === "absence" ||
    code === "no_notice"
  )
    return "destructive"
  return "secondary"
}

export function AttendanceTab({
  clientId,
  wards,
}: {
  clientId: string
  wards: Ward[]
}) {
  const [items, setItems] = useState<AttendanceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [directionId, setDirectionId] = useState<string>("")
  const [wardId, setWardId] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      if (directionId) params.set("directionId", directionId)
      if (wardId) params.set("wardId", wardId)
      const qs = params.toString()
      const res = await fetch(
        `/api/clients/${clientId}/attendances${qs ? `?${qs}` : ""}`
      )
      if (res.ok) setItems(await res.json())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [clientId, from, to, directionId, wardId])

  useEffect(() => {
    load()
  }, [load])

  // Список направлений выводим из самих посещений (без отдельного запроса)
  const directionOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of items) map.set(a.direction.id, a.direction.name)
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    )
  }, [items])

  const wardOptions = useMemo(
    () =>
      wards.map((w) => ({
        id: w.id,
        name: [w.lastName, w.firstName].filter(Boolean).join(" "),
      })),
    [wards]
  )

  // Разделяем пробные и обычные посещения — пробные показываем
  // отдельным выделенным блоком (бизнес-требование).
  const trialItems = useMemo(() => items.filter((a) => a.isTrial), [items])
  const regularItems = useMemo(() => items.filter((a) => !a.isTrial), [items])

  // Итоги
  const stats = useMemo(() => {
    let total = items.length
    let present = 0
    let absent = 0
    let trial = 0
    let makeup = 0
    let totalCharge = 0
    for (const a of items) {
      if (a.attendanceType.countsAsRevenue) present++
      else absent++
      if (a.isTrial) trial++
      if (a.isMakeup) makeup++
      totalCharge += a.chargeAmount
    }
    return { total, present, absent, trial, makeup, totalCharge }
  }, [items])

  function resetFilters() {
    setFrom("")
    setTo("")
    setDirectionId("")
    setWardId("")
  }

  const hasFilters = from || to || directionId || wardId

  const selectedDirection = directionOptions.find((d) => d.id === directionId)
  const selectedWard = wardOptions.find((w) => w.id === wardId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">
              Посещения ({stats.total})
            </CardTitle>
          </div>
          {stats.total > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Посещено: <b className="text-foreground">{stats.present}</b>
              </span>
              <span>
                Пропуски: <b className="text-foreground">{stats.absent}</b>
              </span>
              {stats.trial > 0 && (
                <span>
                  Пробных: <b className="text-foreground">{stats.trial}</b>
                </span>
              )}
              {stats.makeup > 0 && (
                <span>
                  Отработок: <b className="text-foreground">{stats.makeup}</b>
                </span>
              )}
              <span>
                Списано:{" "}
                <b className="text-foreground">{formatMoney(stats.totalCharge)}</b>
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Фильтры */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">С</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[140px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">По</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[140px]"
            />
          </div>
          {directionOptions.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Направление</Label>
              <Select
                value={directionId}
                onValueChange={(v) => setDirectionId(!v || v === "__all" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-[180px]">
                  {selectedDirection ? selectedDirection.name : "Все"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Все</SelectItem>
                  {directionOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {wardOptions.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Подопечный</Label>
              <Select
                value={wardId}
                onValueChange={(v) => setWardId(!v || v === "__all" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-[200px]">
                  {selectedWard ? selectedWard.name : "Все"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Все</SelectItem>
                  {wardOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8"
            >
              <X className="mr-1 size-3.5" />
              Сбросить
            </Button>
          )}
        </div>

        {/* Таблица */}
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Загрузка…
          </p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {hasFilters
              ? "Нет посещений по выбранным фильтрам"
              : "У клиента пока нет отмеченных посещений"}
          </p>
        ) : (
          <>
            {/* Пробные занятия — отдельным выделенным блоком */}
            {trialItems.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 text-sm font-medium dark:border-amber-900/50">
                  <Sparkles className="size-4 text-amber-600 dark:text-amber-400" />
                  <span>Пробные занятия</span>
                  <Badge variant="secondary" className="ml-1 font-normal">
                    {trialItems.length}
                  </Badge>
                </div>
                <AttendanceItemsTable
                  items={trialItems}
                  showWardColumn={wardOptions.length > 1}
                />
              </div>
            )}

            {/* Обычные посещения */}
            {regularItems.length > 0 && (
              <AttendanceItemsTable
                items={regularItems}
                showWardColumn={wardOptions.length > 1}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Таблица посещений — переиспользуется для обычных посещений и пробных.
function AttendanceItemsTable({
  items,
  showWardColumn,
}: {
  items: AttendanceItem[]
  showWardColumn: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[90px]">Дата</TableHead>
          <TableHead className="w-[70px]">Время</TableHead>
          <TableHead>Направление</TableHead>
          <TableHead>Группа</TableHead>
          {showWardColumn && <TableHead>Подопечный</TableHead>}
          <TableHead>Педагог</TableHead>
          <TableHead>Вид</TableHead>
          <TableHead>Период абонемента</TableHead>
          <TableHead className="text-right">Списание</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="whitespace-nowrap">
              {formatDate(a.date)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {a.startTime}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{a.direction.name}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <span>{a.group.name}</span>
                {a.isMakeup && (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px]"
                  >
                    Отработка
                  </Badge>
                )}
              </div>
            </TableCell>
            {showWardColumn && (
              <TableCell className="text-muted-foreground">
                {a.ward?.name || "—"}
              </TableCell>
            )}
            <TableCell className="text-muted-foreground">
              {a.instructorName}
            </TableCell>
            <TableCell>
              <Badge
                variant={typeBadgeVariant(
                  a.attendanceType.code,
                  a.attendanceType.countsAsRevenue
                )}
                title={a.absenceReason || undefined}
              >
                {a.attendanceType.name}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {a.subscription
                ? `${MONTH_SHORT[a.subscription.periodMonth]} ${a.subscription.periodYear}`
                : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {a.chargeAmount > 0 ? (
                formatMoney(a.chargeAmount)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/schedule/lessons/${a.lessonId}`}
                title="Открыть занятие"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
