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
import { Pencil } from "lucide-react"

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

interface GroupData {
  id: string
  name: string
  directionId: string
  branchId: string
  roomId: string
  instructorId: string
  maxStudents: number
}

export function EditGroupDialog({
  group,
  directions,
  branches,
  instructors,
}: {
  group: GroupData
  directions: DirectionOption[]
  branches: BranchOption[]
  instructors: InstructorOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(group.name)
  const [directionId, setDirectionId] = useState(group.directionId)
  const [branchId, setBranchId] = useState(group.branchId)
  const [roomId, setRoomId] = useState(group.roomId)
  const [instructorId, setInstructorId] = useState(group.instructorId)
  const [maxStudents, setMaxStudents] = useState(group.maxStudents)

  const selectedBranch = branches.find((b) => b.id === branchId)
  const availableRooms = selectedBranch?.rooms ?? []

  function resetForm() {
    setName(group.name)
    setDirectionId(group.directionId)
    setBranchId(group.branchId)
    setRoomId(group.roomId)
    setInstructorId(group.instructorId)
    setMaxStudents(group.maxStudents)
    setError(null)
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          directionId,
          branchId,
          roomId,
          instructorId,
          maxStudents,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении группы")
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError("Не удалось сохранить группу")
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
      <DialogTrigger render={<Button variant="ghost" size="icon" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактирование группы</DialogTitle>
          <DialogDescription>
            Измените данные группы
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
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Отмена
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name || !directionId || !branchId || !roomId || !instructorId}
          >
            {loading ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
