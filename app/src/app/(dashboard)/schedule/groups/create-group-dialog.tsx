"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Plus, Trash2, Wallet, AlertTriangle } from "lucide-react"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"
import {
  SalaryRateForm,
  SCHEME_LABELS,
  emptyRate,
  type RateFormValue,
} from "@/components/salary/salary-rate-form"

interface DirectionOption {
  id: string
  name: string
  lessonDuration: number
}

interface BranchOption {
  id: string
  name: string
  rooms: { id: string; name: string }[]
}

interface InstructorOption {
  id: string
  name: string
  employeeBranches: { branchId: string }[]
}

interface ScheduleRow {
  dayOfWeek: number
  startTime: string
  durationMinutes: number
}

const DAY_OPTIONS = [
  { value: 0, label: "Понедельник" },
  { value: 1, label: "Вторник" },
  { value: 2, label: "Среда" },
  { value: 3, label: "Четверг" },
  { value: 4, label: "Пятница" },
  { value: 5, label: "Суббота" },
  { value: 6, label: "Воскресенье" },
]

interface SlotConflict {
  slot: { dayOfWeek: number; startTime: string; durationMinutes: number }
  with: Array<{
    groupId: string
    groupName: string
    startTime: string
    durationMinutes: number
  }>
}

function getDuplicateIndexes(rows: ScheduleRow[]): Set<number> {
  const seen = new Map<string, number>()
  const dups = new Set<number>()
  rows.forEach((r, i) => {
    const key = `${r.dayOfWeek}_${r.startTime}`
    if (seen.has(key)) {
      dups.add(i)
      dups.add(seen.get(key)!)
    } else {
      seen.set(key, i)
    }
  })
  return dups
}

function todayYmd(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function CreateGroupDialog({
  directions,
  branches,
  instructors,
}: {
  directions: DirectionOption[]
  branches: BranchOption[]
  instructors: InstructorOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [branchId, setBranchId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [maxStudents, setMaxStudents] = useState(15)
  const [templates, setTemplates] = useState<ScheduleRow[]>([])
  const [startDate, setStartDate] = useState<string>(todayYmd())
  const [endDate, setEndDate] = useState<string>("")
  const [rate, setRate] = useState<RateFormValue | null>(null)
  const [rateDialogOpen, setRateDialogOpen] = useState(false)
  const [rateDraft, setRateDraft] = useState<RateFormValue>(emptyRate())
  const [conflicts, setConflicts] = useState<SlotConflict[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const selectedBranch = branches.find((b) => b.id === branchId)
  const selectedDirection = directions.find((d) => d.id === directionId)
  const availableRooms = selectedBranch?.rooms ?? []
  const duplicateIdx = getDuplicateIndexes(templates)
  const hasDuplicates = duplicateIdx.size > 0

  function addTemplate() {
    setTemplates((prev) => [
      ...prev,
      {
        dayOfWeek: 0,
        startTime: "09:00",
        durationMinutes: selectedDirection?.lessonDuration ?? 45,
      },
    ])
  }

  function removeTemplate(index: number) {
    setTemplates((prev) => prev.filter((_, i) => i !== index))
  }

  function updateTemplate(index: number, field: keyof ScheduleRow, value: string | number) {
    setTemplates((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    )
  }

  function resetForm() {
    setName("")
    setDirectionId("")
    setBranchId("")
    setRoomId("")
    setInstructorId("")
    setMaxStudents(15)
    setTemplates([])
    setStartDate(todayYmd())
    setEndDate("")
    setRate(null)
    setRateDialogOpen(false)
    setRateDraft(emptyRate())
    setError(null)
    setConflicts(null)
    setConfirmOpen(false)
  }

  function openRateDialog() {
    setRateDraft(rate ?? emptyRate())
    setRateDialogOpen(true)
  }

  function applyRate() {
    setRate(rateDraft)
    setRateDialogOpen(false)
  }

  function clearRate() {
    setRate(null)
    setRateDialogOpen(false)
  }

  async function createGroup() {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        directionId,
        branchId,
        roomId,
        instructorId,
        maxStudents,
        templates: templates.length > 0 ? templates : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        salaryRate: rate
          ? {
              scheme: rate.scheme,
              ratePerStudent: rate.ratePerStudent,
              ratePerLesson: rate.ratePerLesson,
              fixedPerShift: rate.fixedPerShift,
              percentOfPayments: rate.percentOfPayments,
              brackets: rate.brackets,
            }
          : undefined,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Ошибка при создании группы")
      return false
    }

    return true
  }

  async function handleSubmit() {
    setError(null)

    if (hasDuplicates) {
      setError(
        "В расписании повторяется одна и та же пара «день недели + время». Уберите дубликаты.",
      )
      return
    }

    setLoading(true)

    try {
      // Сначала — проверка пересечений с другими группами в этом кабинете.
      if (templates.length > 0 && roomId) {
        const checkRes = await fetch("/api/groups/check-conflicts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, templates }),
        })
        if (checkRes.ok) {
          const data = (await checkRes.json()) as { conflicts: SlotConflict[] }
          if (data.conflicts.length > 0) {
            setConflicts(data.conflicts)
            setConfirmOpen(true)
            setLoading(false)
            return
          }
        }
      }

      const ok = await createGroup()
      if (!ok) return

      resetForm()
      setOpen(false)
      router.refresh()
    } catch {
      setError("Не удалось создать группу")
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmCreate() {
    setLoading(true)
    setError(null)
    try {
      const ok = await createGroup()
      if (!ok) return
      resetForm()
      setOpen(false)
      router.refresh()
    } catch {
      setError("Не удалось создать группу")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val)
        if (!val) resetForm()
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        Группа
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая группа</DialogTitle>
          <DialogDescription>
            Заполните данные группы и настройте расписание
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              placeholder="Например: Развивайка 3-4 (Пн/Ср)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Направление</Label>
            <Select value={directionId} onValueChange={(v) => { if (v) setDirectionId(v) }}>
              <SelectTrigger className="w-full">
                {directionId ? directions.find(d => d.id === directionId)?.name : <span className="text-muted-foreground">Выберите направление</span>}
              </SelectTrigger>
              <SelectContent>
                {directions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Филиал</Label>
              <Select
                value={branchId}
                onValueChange={(val) => {
                  if (val) setBranchId(val)
                  setRoomId("")
                }}
              >
                <SelectTrigger className="w-full">
                  {branchId ? branches.find(b => b.id === branchId)?.name : <span className="text-muted-foreground">Филиал</span>}
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Кабинет</Label>
              <Select value={roomId} onValueChange={(v) => { if (v) setRoomId(v) }} disabled={!branchId}>
                <SelectTrigger className="w-full">
                  {roomId ? availableRooms.find(r => r.id === roomId)?.name : <span className="text-muted-foreground">Кабинет</span>}
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Педагог</Label>
              <Select value={instructorId} onValueChange={(v) => { if (v) setInstructorId(v) }}>
                <SelectTrigger className="w-full">
                  {instructorId ? instructors.find(i => i.id === instructorId)?.name : <span className="text-muted-foreground">Педагог</span>}
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const filtered = filterEmployeesByBranch(instructors, branchId)
                    const selected = instructors.find((x) => x.id === instructorId)
                    const showOutOfBranch =
                      selected && !isEmployeeAvailableInBranch(selected, branchId)
                    const visible = showOutOfBranch
                      ? [selected!, ...filtered.filter((x) => x.id !== selected!.id)]
                      : filtered
                    return visible.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))
                  })()}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Макс. учеников</Label>
              <Input
                type="number"
                min={1}
                value={maxStudents}
                onChange={(e) => setMaxStudents(parseInt(e.target.value) || 15)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Дата старта</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Пусто = сегодня. Расписание сгенерируется на год вперёд.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Дата окончания</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
              />
              <p className="text-xs text-muted-foreground">
                Пусто = год от старта. Указывайте для временных групп.
              </p>
            </div>
          </div>

          {/* Ставка группы */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Ставка группы</div>
                <div className="text-xs text-muted-foreground">
                  {rate ? SCHEME_LABELS[rate.scheme] : "Стандартная (по личным ставкам педагогов)"}
                </div>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={openRateDialog}>
              Изменить
            </Button>
          </div>

          {/* Шаблоны расписания */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Расписание</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addTemplate}>
                <Plus className="mr-1 size-3" />
                Добавить день
              </Button>
            </div>

            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Нажмите &laquo;Добавить день&raquo;, чтобы задать расписание
              </p>
            )}

            {templates.map((t, i) => {
              const isDup = duplicateIdx.has(i)
              return (
                <div
                  key={i}
                  className={
                    isDup
                      ? "flex items-center gap-2 rounded-md border border-destructive/60 bg-destructive/5 p-1"
                      : "flex items-center gap-2"
                  }
                >
                  <Select
                    value={String(t.dayOfWeek)}
                    onValueChange={(v) => { if (v !== null && v !== undefined && v !== "") updateTemplate(i, "dayOfWeek", parseInt(v)) }}
                  >
                    <SelectTrigger className="w-[140px]">
                      {DAY_OPTIONS.find((d) => d.value === t.dayOfWeek)?.label ?? "День недели"}
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={String(d.value)}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="time"
                    className="w-[100px]"
                    value={t.startTime}
                    onChange={(e) => updateTemplate(i, "startTime", e.target.value)}
                  />

                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      className="w-[70px]"
                      min={1}
                      value={t.durationMinutes}
                      onChange={(e) =>
                        updateTemplate(i, "durationMinutes", parseInt(e.target.value) || 45)
                      }
                    />
                    <span className="text-xs text-muted-foreground">мин</span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeTemplate(i)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              )
            })}

            {hasDuplicates && (
              <p className="text-xs text-destructive">
                Эти строки повторяются — один и тот же день и время. Удалите дубликат или измените время.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Отмена
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={
              loading ||
              !name ||
              !directionId ||
              !branchId ||
              !roomId ||
              !instructorId ||
              hasDuplicates
            }
          >
            {loading ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Вложенная модалка «Конфликт расписания» */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" />
              Кабинет уже занят
            </DialogTitle>
            <DialogDescription>
              В выбранном кабинете в это время уже занимаются другие группы.
              Вы можете изменить день или время — или создать группу всё равно.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(conflicts ?? []).map((c, i) => (
              <div key={i} className="rounded-md border p-3 text-sm">
                <div className="font-medium">
                  {DAY_OPTIONS.find((d) => d.value === c.slot.dayOfWeek)?.label},{" "}
                  {c.slot.startTime} ({c.slot.durationMinutes} мин)
                </div>
                <div className="mt-1 text-muted-foreground">
                  Пересекается с:
                </div>
                <ul className="mt-1 space-y-0.5">
                  {c.with.map((w) => (
                    <li key={w.groupId}>
                      <span className="font-medium">{w.groupName}</span>{" "}
                      <span className="text-muted-foreground">
                        — {w.startTime} ({w.durationMinutes} мин)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false)
                setConflicts(null)
              }}
            >
              Изменить расписание
            </Button>
            <Button onClick={handleConfirmCreate} disabled={loading}>
              {loading ? "Создание..." : "Создать всё равно"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Вложенная модалка «Ставка группы» */}
      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ставка группы</DialogTitle>
            <DialogDescription>
              Если задана, перекрывает личные ставки педагогов на занятиях этой группы.
            </DialogDescription>
          </DialogHeader>

          <SalaryRateForm value={rateDraft} onChange={setRateDraft} />

          <DialogFooter className="gap-2">
            {rate && (
              <Button variant="ghost" onClick={clearRate} className="text-destructive">
                Снять ставку
              </Button>
            )}
            <Button variant="outline" onClick={() => setRateDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={applyRate}>Применить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
