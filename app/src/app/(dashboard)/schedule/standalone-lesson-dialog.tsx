"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"

interface BranchOption {
  id: string
  name: string
  rooms?: { id: string; name: string }[]
}

interface DirectionOption {
  id: string
  name: string
}

interface InstructorOption {
  id: string
  firstName: string | null
  lastName: string | null
  role?: string
}

export function StandaloneLessonDialog({ defaultDate }: { defaultDate: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [instructors, setInstructors] = useState<InstructorOption[]>([])
  const [branchId, setBranchId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [instructorId, setInstructorId] = useState("")
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState("10:00")
  const [duration, setDuration] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      fetch("/api/branches").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/directions").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/employees").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([bs, ds, es]) => {
        if (cancelled) return
        setBranches(Array.isArray(bs) ? bs : [])
        setDirections(Array.isArray(ds) ? ds : [])
        const list: InstructorOption[] = Array.isArray(es) ? es : []
        // На разовое занятие ставим только тех, кто может вести: инструктор,
        // управляющий или владелец. Админам/readonly не предлагаем.
        setInstructors(list.filter((e) => e.role === "instructor" || e.role === "manager" || e.role === "owner"))
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [open])

  const rooms = useMemo(() => {
    const b = branches.find((x) => x.id === branchId)
    return b?.rooms || []
  }, [branches, branchId])

  // При смене филиала сбрасываем кабинет (старый мог быть из другого филиала).
  useEffect(() => {
    setRoomId("")
  }, [branchId])

  const canSubmit = !!branchId && !!roomId && !!directionId && !!instructorId && !!date && !!startTime && duration > 0 && !saving

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/standalone-lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          roomId,
          directionId,
          instructorId,
          date,
          startTime,
          durationMinutes: duration,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось создать занятие")
        return
      }
      const lesson = await res.json()
      setOpen(false)
      router.push(`/schedule/lessons/${lesson.id}`)
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        Занятие
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Разовое занятие</DialogTitle>
          <DialogDescription>
            Создаётся занятие вне расписания группы. Используйте для индивидуальных
            или единичных уроков. Группа в списке групп не появится.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Филиал</Label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-9 w-full rounded border bg-background px-3 text-sm"
            >
              <option value="">— выберите филиал —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Кабинет</Label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!branchId}
              className="h-9 w-full rounded border bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">— выберите кабинет —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Направление</Label>
            <select
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              className="h-9 w-full rounded border bg-background px-3 text-sm"
            >
              <option value="">— выберите направление —</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Педагог</Label>
            <select
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className="h-9 w-full rounded border bg-background px-3 text-sm"
            >
              <option value="">— выберите педагога —</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {[i.lastName, i.firstName].filter(Boolean).join(" ") || "Без имени"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Дата</Label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-full rounded border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Время</Label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-9 w-full rounded border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Длит. (мин)</Label>
              <input
                type="number"
                min={1}
                max={600}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10) || 0)}
                className="h-9 w-full rounded border bg-background px-3 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Создание..." : "Создать занятие"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
