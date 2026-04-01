"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Plus, Trash2 } from "lucide-react"

interface Plan {
  id: string
  name: string
  pricePerBranch: string
  description: string | null
  isActive: boolean
  createdAt: string
  _count: { subscriptions: number }
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", pricePerBranch: "", description: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const fetchPlans = () => {
    fetch("/api/admin/plans")
      .then((r) => r.json())
      .then(setPlans)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPlans() }, [])

  const openCreate = () => {
    setEditId(null)
    setForm({ name: "", pricePerBranch: "", description: "" })
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (plan: Plan) => {
    setEditId(plan.id)
    setForm({ name: plan.name, pricePerBranch: String(plan.pricePerBranch), description: plan.description || "" })
    setError("")
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setError("")
    setSaving(true)
    try {
      const url = editId ? `/api/admin/plans/${editId}` : "/api/admin/plans"
      const method = editId ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          pricePerBranch: parseFloat(form.pricePerBranch),
          description: form.description || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setDialogOpen(false)
      fetchPlans()
    } catch { setError("Ошибка сети") }
    finally { setSaving(false) }
  }

  const handleDeactivate = async (planId: string) => {
    await fetch(`/api/admin/plans/${planId}`, { method: "DELETE" })
    fetchPlans()
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Тарифные планы</h1>
          <p className="text-sm text-muted-foreground">Управление тарифами</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />Новый тариф
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Цена за филиал</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>Подписок</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell>{Number(plan.pricePerBranch).toLocaleString("ru")} ₽/мес</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{plan.description || "—"}</TableCell>
                  <TableCell>{plan._count.subscriptions}</TableCell>
                  <TableCell>
                    <Badge variant={plan.isActive ? "default" : "secondary"}>
                      {plan.isActive ? "Активен" : "Неактивен"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(plan)}>
                        <Pencil className="size-4" />
                      </Button>
                      {plan.isActive && (
                        <Button variant="ghost" size="sm" onClick={() => handleDeactivate(plan.id)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Нет тарифов</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Редактировать тариф" : "Новый тариф"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Название *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Стандарт" /></div>
            <div className="space-y-2"><Label>Цена за филиал (₽/мес) *</Label><Input type="number" min={0} value={form.pricePerBranch} onChange={(e) => setForm({ ...form, pricePerBranch: e.target.value })} placeholder="5000" /></div>
            <div className="space-y-2"><Label>Описание</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="5 000 ₽/мес за филиал" /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.pricePerBranch}>
              {saving ? "Сохранение..." : editId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
