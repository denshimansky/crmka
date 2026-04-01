"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus } from "lucide-react"

export function CreateBranchDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [workingHoursStart, setWorkingHoursStart] = useState("08:00")
  const [workingHoursEnd, setWorkingHoursEnd] = useState("21:00")

  function resetForm() {
    setName(""); setAddress(""); setWorkingHoursStart("08:00"); setWorkingHoursEnd("21:00"); setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError("Название обязательно"); return }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || undefined,
          workingHoursStart: workingHoursStart || undefined,
          workingHoursEnd: workingHoursEnd || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Ошибка создания")
        return
      }
      setOpen(false)
      resetForm()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Филиал
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый филиал</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Филиал на Ленина" />
          </div>
          <div className="space-y-1.5">
            <Label>Адрес</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ул. Ленина, 42" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Начало работы</Label>
              <Input type="time" value={workingHoursStart} onChange={(e) => setWorkingHoursStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Конец работы</Label>
              <Input type="time" value={workingHoursEnd} onChange={(e) => setWorkingHoursEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
