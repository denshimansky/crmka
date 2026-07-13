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
  priceTiers: Record<string, number> | null
  description: string | null
  isActive: boolean
  createdAt: string
  _count: { subscriptions: number }
}

type TierRow = { count: string; price: string }

function tiersToRows(tiers: Record<string, number> | null): TierRow[] {
  return Object.entries(tiers || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([count, price]) => ({ count, price: String(price) }))
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", pricePerBranch: "", description: "" })
  const [tiers, setTiers] = useState<TierRow[]>([])
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
    setTiers([])
    setError("")
    setDialogOpen(true)
  }

  const openEdit = (plan: Plan) => {
    setEditId(plan.id)
    setForm({ name: plan.name, pricePerBranch: String(plan.pricePerBranch), description: plan.description || "" })
    setTiers(tiersToRows(plan.priceTiers))
    setError("")
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setError("")
    setSaving(true)
    try {
      const priceTiers: Record<string, number> = {}
      for (const row of tiers) {
        if (!row.count.trim() && !row.price.trim()) continue
        const count = Number(row.count)
        const price = Number(row.price)
        if (!row.count.trim() || !row.price.trim() || !Number.isInteger(count) || count < 1 || !Number.isFinite(price) || price < 0) {
          setError("Сетка: в каждой ступени заполните и число филиалов (целое от 1), и цену (от 0)")
          return
        }
        if (priceTiers[String(count)] !== undefined) {
          setError(`Сетка: ступень для ${count} филиал(ов) указана дважды`)
          return
        }
        priceTiers[String(count)] = price
      }
      const url = editId ? `/api/admin/plans/${editId}` : "/api/admin/plans"
      const method = editId ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          pricePerBranch: parseFloat(form.pricePerBranch),
          priceTiers: Object.keys(priceTiers).length ? priceTiers : null,
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
                <TableHead>Цена (сетка по филиалам, ₽/мес)</TableHead>
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
                  <TableCell>
                    {plan.priceTiers ? (
                      <span className="text-sm">
                        {tiersToRows(plan.priceTiers).map((t) => `${t.count} — ${Number(t.price).toLocaleString("ru")} ₽`).join(" · ")}
                      </span>
                    ) : (
                      `${Number(plan.pricePerBranch).toLocaleString("ru")} ₽/мес за филиал`
                    )}
                  </TableCell>
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
            <div className="space-y-2"><Label>Цена за филиал (₽/мес, если сетка не задана) *</Label><Input type="number" step="0.01" min={0} value={form.pricePerBranch} onChange={(e) => setForm({ ...form, pricePerBranch: e.target.value })} placeholder="5000" /></div>
            <div className="space-y-2">
              <Label>Сетка цен по филиалам (итог в месяц)</Label>
              {tiers.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="number" min={1} step="1" className="w-24" placeholder="Фил." value={row.count}
                    onChange={(e) => setTiers(tiers.map((t, j) => j === i ? { ...t, count: e.target.value } : t))} />
                  <span className="text-sm text-muted-foreground">фил. —</span>
                  <Input type="number" min={0} step="0.01" placeholder="Цена в мес" value={row.price}
                    onChange={(e) => setTiers(tiers.map((t, j) => j === i ? { ...t, price: e.target.value } : t))} />
                  <Button variant="ghost" size="sm" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setTiers([...tiers, { count: String(tiers.length + 1), price: "" }])}>
                <Plus className="mr-1 size-3" />Добавить ступень
              </Button>
              <p className="text-xs text-muted-foreground">
                Если сетка задана, цена в месяц берётся из неё (итог за все филиалы, а не за один).
                Филиалы сверх сетки добавляют шаг последней ступени. Без сетки — линейно: цена за филиал × количество.
              </p>
            </div>
            <div className="space-y-2"><Label>Описание</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Сетка: 1 фил. — 5 000, 2 — 9 000 ₽/мес" /></div>
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
