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
  SelectValue,
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
import { Plus, Trash2 } from "lucide-react"

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

  const selectedBranch = branches.find((b) => b.id === branchId)
  const selectedDirection = directions.find((d) => d.id === directionId)
  const availableRooms = selectedBranch?.rooms ?? []

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
    setError(null)
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
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
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Ошибка при создании группы")
        return
      }

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
                  {instructors.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
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

            {templates.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={String(t.dayOfWeek)}
                  onValueChange={(v) => { if (v) updateTemplate(i, "dayOfWeek", parseInt(v)) }}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
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
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Отмена
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name || !directionId || !branchId || !roomId || !instructorId}
          >
            {loading ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
