"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2 } from "lucide-react"

interface BranchData {
  id: string
  name: string
  address: string | null
  workingHoursStart: string | null
  workingHoursEnd: string | null
  hasRooms: boolean
}

export function EditBranchDialog({ branch }: { branch: BranchData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(branch.name)
  const [address, setAddress] = useState(branch.address ?? "")
  const [workingHoursStart, setStart] = useState(branch.workingHoursStart ?? "")
  const [workingHoursEnd, setEnd] = useState(branch.workingHoursEnd ?? "")

  function resetForm() {
    setName(branch.name)
    setAddress(branch.address ?? "")
    setStart(branch.workingHoursStart ?? "")
    setEnd(branch.workingHoursEnd ?? "")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError("Название обязательно"); return }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/branches/${branch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || "",
          workingHoursStart: workingHoursStart || "",
          workingHoursEnd: workingHoursEnd || "",
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
    const warning = branch.hasRooms
      ? `Удалить филиал «${branch.name}»? Кабинеты, группы и расписание останутся в БД (soft-delete), но станут недоступны.`
      : `Удалить филиал «${branch.name}»?`
    if (!confirm(warning)) return

    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/branches/${branch.id}`, { method: "DELETE" })
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

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактирование филиала</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Адрес</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ул. Ленина, 42" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Начало работы</Label>
              <Input type="time" value={workingHoursStart} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Конец работы</Label>
              <Input type="time" value={workingHoursEnd} onChange={(e) => setEnd(e.target.value)} />
            </div>
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
