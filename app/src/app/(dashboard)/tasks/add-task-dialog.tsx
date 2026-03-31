"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Plus } from "lucide-react"

interface EmployeeOption { id: string; name: string }
interface ClientOption { id: string; name: string }

export function AddTaskDialog({ employees, clients }: { employees: EmployeeOption[]; clients: ClientOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [assignedTo, setAssignedTo] = useState("")
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [clientId, setClientId] = useState("")
  const [description, setDescription] = useState("")

  function reset() { setTitle(""); setAssignedTo(""); setDueDate(new Date().toISOString().slice(0, 10)); setClientId(""); setDescription(""); setError(null) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!title) { setError("Введите заголовок"); return }
    if (!assignedTo) { setError("Выберите исполнителя"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, assignedTo, dueDate, clientId: clientId || undefined, description: description || undefined }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Ошибка"); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  const selEmp = employees.find(e => e.id === assignedTo)
  const selCl = clients.find(c => c.id === clientId)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}><Plus className="mr-2 size-4" />Задача</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Новая задача</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Заголовок *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Что нужно сделать?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Исполнитель *</Label>
              <Select value={assignedTo} onValueChange={v => { if (v) setAssignedTo(v) }}>
                <SelectTrigger className="w-full">{selEmp ? selEmp.name : "Выберите"}</SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Дата *</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Клиент</Label>
            <Select value={clientId} onValueChange={v => { if (v !== null) setClientId(v) }}>
              <SelectTrigger className="w-full">{selCl ? selCl.name : "Без привязки"}</SelectTrigger>
              <SelectContent>
                <SelectItem value="">Без привязки</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Необязательно" />
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
