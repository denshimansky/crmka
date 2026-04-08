"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Trash2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react"
import { PageHelp } from "@/components/page-help"

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

interface Holiday {
  id: string
  date: string
  name: string
  isWorkingDay: boolean
}

export default function ProductionCalendarPage() {
  const router = useRouter()
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editHoliday, setEditHoliday] = useState<Holiday | null>(null)
  const [formDate, setFormDate] = useState("")
  const [formName, setFormName] = useState("")
  const [formIsWorkingDay, setFormIsWorkingDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHolidays = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/production-calendar?year=${year}`)
      if (res.ok) setHolidays(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [year])

  useEffect(() => { loadHolidays() }, [loadHolidays])

  function openCreate(date?: string) {
    setEditHoliday(null)
    setFormDate(date || `${year}-${String(month + 1).padStart(2, "0")}-01`)
    setFormName("")
    setFormIsWorkingDay(false)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(h: Holiday) {
    setEditHoliday(h)
    setFormDate(h.date)
    setFormName(h.name)
    setFormIsWorkingDay(h.isWorkingDay)
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formDate || !formName.trim()) {
      setError("Заполните дату и название")
      return
    }
    setSaving(true)
    setError(null)

    try {
      const url = editHoliday
        ? `/api/production-calendar/${editHoliday.id}`
        : "/api/production-calendar"
      const method = editHoliday ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: formDate,
          name: formName.trim(),
          isWorkingDay: formIsWorkingDay,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setDialogOpen(false)
      loadHolidays()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить запись из производственного календаря?")) return
    try {
      await fetch(`/api/production-calendar/${id}`, { method: "DELETE" })
      loadHolidays()
    } catch { /* ignore */ }
  }

  // Calendar grid
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // Monday = 0, Sunday = 6
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1

  const holidayMap = new Map<string, Holiday>()
  for (const h of holidays) {
    holidayMap.set(h.date, h)
  }

  const weeks: (number | null)[][] = []
  let currentWeek: (number | null)[] = Array(startDow).fill(null)
  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => year - 2 + i)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Производственный календарь</h1>
            <PageHelp pageKey="schedule/calendar" />
          </div>
          <p className="text-sm text-muted-foreground">
            Праздники и рабочие/выходные дни
          </p>
        </div>
        <Button onClick={() => openCreate()}>
          <Plus className="mr-2 size-4" />
          Добавить день
        </Button>
      </div>

      {/* Year selector + month nav */}
      <div className="flex items-center gap-4">
        <Select value={String(year)} onValueChange={(v) => { if (v) setYear(Number(v)) }}>
          <SelectTrigger className="w-[120px]">
            {year}
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[120px] text-center font-medium">
            {MONTH_NAMES[month]} {year}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <Card>
        <CardContent className="p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Загрузка...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {DAY_NAMES.map(d => (
                      <th key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, wi) => (
                    <tr key={wi}>
                      {week.map((day, di) => {
                        if (day === null) {
                          return <td key={di} className="p-1" />
                        }
                        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                        const holiday = holidayMap.get(dateStr)
                        const isWeekend = di >= 5
                        const isHoliday = holiday && !holiday.isWorkingDay
                        const isWorkingOverride = holiday?.isWorkingDay

                        let cellClass = "rounded-lg p-2 text-center text-sm cursor-pointer hover:bg-accent transition-colors min-h-[56px]"
                        if (isHoliday) cellClass += " bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                        else if (isWorkingOverride) cellClass += " bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                        else if (isWeekend) cellClass += " text-red-500"

                        return (
                          <td key={di} className="p-1">
                            <div
                              className={cellClass}
                              onClick={() => holiday ? openEdit(holiday) : openCreate(dateStr)}
                            >
                              <div className="font-medium">{day}</div>
                              {holiday && (
                                <div className="mt-0.5 truncate text-[10px] leading-tight">
                                  {holiday.name}
                                </div>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Holiday list for the year */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Все записи за {year} год ({holidays.length})
            </span>
          </div>
          {holidays.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Нет записей за выбранный год
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(h.date + "T00:00:00").toLocaleDateString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell>
                        {h.isWorkingDay ? (
                          <Badge variant="default">Рабочий день</Badge>
                        ) : (
                          <Badge variant="destructive">Выходной</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => handleDelete(h.id)}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editHoliday ? "Редактировать запись" : "Новая запись"}
            </DialogTitle>
            <DialogDescription>
              Добавьте праздник или рабочий день в производственный календарь
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Дата</Label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                placeholder="Новый год"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsWorkingDay}
                  onChange={(e) => setFormIsWorkingDay(e.target.checked)}
                  className="size-4 rounded border"
                />
                <span>Рабочий день (перенос)</span>
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editHoliday ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
