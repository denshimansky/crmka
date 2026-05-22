"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Trash2 } from "lucide-react"

interface Branch {
  id: string
  name: string
}

interface RoomData {
  id: string
  name: string
  capacity: number
  branchId: string
}

export function EditRoomDialog({ room, branches }: { room: RoomData; branches: Branch[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(room.name)
  const [capacity, setCapacity] = useState(String(room.capacity))
  const [branchId, setBranchId] = useState(room.branchId)

  function resetForm() {
    setName(room.name)
    setCapacity(String(room.capacity))
    setBranchId(room.branchId)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError("Название обязательно"); return }
    if (!branchId) { setError("Выберите филиал"); return }
    const capacityNum = Number(capacity)
    if (!capacityNum || capacityNum < 1) { setError("Вместимость минимум 1"); return }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          capacity: capacityNum,
          branchId,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Удалить кабинет «${room.name}»? Группы и занятия, связанные с этим кабинетом, останутся, но кабинет станет недоступен для новых.`)) return

    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка удаления")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setDeleting(false)
    }
  }

  const selectedBranch = branches.find(b => b.id === branchId)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger
        render={(
          <Badge
            variant="outline"
            className="cursor-pointer text-xs hover:bg-accent"
          />
        )}
      >
        {room.name} ({room.capacity} чел.)
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактирование кабинета</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Филиал *</Label>
            <Select value={branchId} onValueChange={(v) => { if (v) setBranchId(v) }}>
              <SelectTrigger className="w-full">
                {selectedBranch ? selectedBranch.name : <span className="text-muted-foreground">Выберите филиал</span>}
              </SelectTrigger>
              <SelectContent>
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Вместимость</Label>
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={loading || deleting}
            >
              <Trash2 className="mr-2 size-4" />
              {deleting ? "Удаление..." : "Удалить"}
            </Button>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
              <Button type="submit" disabled={loading || deleting}>
                {loading ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
