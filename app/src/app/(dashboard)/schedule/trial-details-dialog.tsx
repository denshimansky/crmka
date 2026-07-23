"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useRoleNames } from "@/components/role-names-provider"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"

/** Данные индивидуального пробного для карточки в расписании (собирает schedule/page.tsx). */
export interface TrialCardInfo {
  id: string
  clientId: string
  wardId: string | null
  applicationId: string | null
  clientName: string
  wardName: string | null
  date: string // YYYY-MM-DD
  startTime: string | null
  durationMinutes: number | null
  directionId: string | null
  directionName: string
  instructorName: string
  instructorId: string | null
  roomId: string | null
  roomName: string
  /** Филиал кабинета пробного — по нему фильтруются кабинеты/инструкторы при переносе. */
  branchId: string | null
}

interface InstructorOption {
  id: string
  firstName: string | null
  lastName: string | null
  role: string
  isActive: boolean
  employeeBranches?: { branchId: string }[]
}

interface RoomOption {
  id: string
  name: string
  branchId: string
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

/**
 * Клик по карточке индивидуального пробного в расписании: диалог с деталями
 * (дата/время/инструктор/кабинет) + отметка «Был / Не пришёл» + перенос + ссылка
 * на карточку клиента. У индивидуального пробного нет сущности занятия и
 * карточки занятия — этот диалог единственное место отметки из расписания
 * (баг #60). Перенос атомарный: POST /api/trial-lessons с
 * rescheduleOfTrialLessonId — старое пробное отменяется в одной транзакции
 * с созданием нового.
 */
export function TrialDetailsDialog({
  trial,
  canReschedule,
  canMark = false,
  triggerClassName,
  triggerStyle,
  triggerTitle,
  children,
}: {
  trial: TrialCardInfo
  canReschedule: boolean
  canMark?: boolean
  triggerClassName?: string
  triggerStyle?: CSSProperties
  triggerTitle?: string
  children: ReactNode
}) {
  const router = useRouter()
  const roleNames = useRoleNames()
  const [open, setOpen] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(trial.date)
  const [time, setTime] = useState(trial.startTime || "10:00")
  const [instructorId, setInstructorId] = useState(trial.instructorId || "")
  const [roomId, setRoomId] = useState(trial.roomId || "")

  const [instructors, setInstructors] = useState<InstructorOption[]>([])
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [refLoaded, setRefLoaded] = useState(false)

  // Справочники грузим лениво — только когда открыли форму переноса.
  useEffect(() => {
    if (!rescheduling || refLoaded) return
    let cancelled = false
    async function load() {
      try {
        const [emp, rm] = await Promise.all([fetch("/api/employees"), fetch("/api/rooms")])
        if (cancelled) return
        if (emp.ok) {
          const all: InstructorOption[] = await emp.json()
          setInstructors(
            all.filter((e) => e.isActive && ["instructor", "owner", "manager"].includes(e.role)),
          )
        }
        if (rm.ok) setRooms(await rm.json())
        if (!emp.ok || !rm.ok) setError("Не удалось загрузить справочники")
        setRefLoaded(true)
      } catch {
        if (!cancelled) setError("Не удалось загрузить справочники")
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [rescheduling, refLoaded])

  function resetForm() {
    setDate(trial.date)
    setTime(trial.startTime || "10:00")
    setInstructorId(trial.instructorId || "")
    setRoomId(trial.roomId || "")
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setRescheduling(false)
      setError(null)
      resetForm()
    }
  }

  // Перенос возможен, только если есть из чего собрать новое пробное
  // (у старых/импортированных записей ward/direction могут отсутствовать).
  const reschedulable = canReschedule && !!trial.wardId && !!trial.directionId

  async function handleReschedule(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!date) return setError("Укажите дату")
    if (!time) return setError("Укажите время")
    if (!instructorId) return setError(`Заполните поле «${roleNames.instructor}»`)
    if (!roomId) return setError("Выберите кабинет")
    if (
      date === trial.date &&
      time === (trial.startTime || "") &&
      instructorId === (trial.instructorId || "") &&
      roomId === (trial.roomId || "")
    ) {
      return setError("Изменений нет — поменяйте дату, время, инструктора или кабинет.")
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/trial-lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: trial.clientId,
          wardId: trial.wardId,
          applicationId: trial.applicationId ?? undefined,
          directionId: trial.directionId,
          instructorId,
          roomId,
          startTime: time,
          durationMinutes: trial.durationMinutes ?? undefined,
          scheduledDate: date,
          rescheduleOfTrialLessonId: trial.id,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось перенести пробное")
        return
      }
      setOpen(false)
      setRescheduling(false)
      router.refresh()
    } catch {
      setError("Сетевая ошибка")
    } finally {
      setSubmitting(false)
    }
  }

  // Отметка статуса — тот же эндпоинт, что в сетке посещений и карточке
  // занятия: PATCH двигает этап заявки, воронку подопечного и автозадачи.
  // Расписание показывает только status=scheduled, поэтому после отметки
  // карточка пробного уходит из сетки (как проведённое).
  async function handleMark(status: "attended" | "no_show") {
    setError(null)
    setMarking(true)
    try {
      const res = await fetch(`/api/trial-lessons/${trial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось отметить пробное")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Сетевая ошибка")
    } finally {
      setMarking(false)
    }
  }

  const childName = trial.wardName || trial.clientName

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen(true)
          }
        }}
        title={triggerTitle}
        className={`cursor-pointer text-left ${triggerClassName || ""}`}
        style={triggerStyle}
      >
        {children}
      </div>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Пробное занятие</DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Ребёнок</span>
              <span className="text-right font-medium">{childName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Родитель</span>
              <span className="text-right">{trial.clientName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Когда</span>
              <span className="text-right">
                {fmtDate(trial.date)}
                {trial.startTime ? `, ${trial.startTime}` : ""}
                {trial.durationMinutes ? ` (${trial.durationMinutes} мин)` : ""}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Направление</span>
              <span className="text-right">{trial.directionName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{roleNames.instructor}</span>
              <span className="text-right">{trial.instructorName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Кабинет</span>
              <span className="text-right">{trial.roomName}</span>
            </div>
          </div>

          {rescheduling && (
            <form onSubmit={handleReschedule} className="space-y-3 border-t pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Дата *</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Время *</Label>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{roleNames.instructor} *</Label>
                <Select value={instructorId} onValueChange={(v) => v && setInstructorId(v)}>
                  <SelectTrigger className="w-full">
                    {(() => {
                      const sel = instructors.find((e) => e.id === instructorId)
                      if (!sel) {
                        return trial.instructorId === instructorId && instructorId
                          ? trial.instructorName
                          : <span className="text-muted-foreground">Выберите из списка</span>
                      }
                      return [sel.lastName, sel.firstName].filter(Boolean).join(" ") || "Без имени"
                    })()}
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      // Инструкторы филиала пробного (по кабинету); текущий выбранный
                      // показываем, даже если он из другого филиала.
                      const filtered = filterEmployeesByBranch(instructors, trial.branchId)
                      const selected = instructors.find((x) => x.id === instructorId)
                      const showOutOfBranch =
                        selected && !isEmployeeAvailableInBranch(selected, trial.branchId)
                      const visible = showOutOfBranch
                        ? [selected!, ...filtered.filter((x) => x.id !== selected!.id)]
                        : filtered
                      return visible.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {[e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"}
                        </SelectItem>
                      ))
                    })()}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Кабинет *</Label>
                <Select value={roomId} onValueChange={(v) => v && setRoomId(v)}>
                  <SelectTrigger className="w-full">
                    {rooms.find((r) => r.id === roomId)?.name ||
                      (trial.roomId === roomId && roomId ? (
                        trial.roomName
                      ) : (
                        <span className="text-muted-foreground">Выберите кабинет</span>
                      ))}
                  </SelectTrigger>
                  <SelectContent>
                    {/* Кабинет определяет филиал пробного — предлагаем только
                        кабинеты филиала (fallback: все, если филиал неизвестен). */}
                    {rooms
                      .filter((r) => !trial.branchId || r.branchId === trial.branchId)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRescheduling(false)
                    setError(null)
                    resetForm()
                  }}
                >
                  Отмена
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Сохранение…" : "Перенести"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {!rescheduling && canMark && (
            <div className="flex items-center gap-2 border-t pt-3">
              <span className="mr-auto text-sm text-muted-foreground">Отметить:</span>
              <Button
                type="button"
                variant="outline"
                disabled={marking}
                className="border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30"
                onClick={() => handleMark("attended")}
              >
                Был
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={marking}
                className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={() => handleMark("no_show")}
              >
                Не пришёл
              </Button>
            </div>
          )}

          {!rescheduling && (
            <DialogFooter>
              <Link
                href={`/crm/clients/${trial.clientId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Карточка клиента
              </Link>
              {reschedulable && (
                <Button type="button" onClick={() => setRescheduling(true)}>
                  Перенести
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
