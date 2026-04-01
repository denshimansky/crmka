"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
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
import { Plus, Building2, Eye } from "lucide-react"

interface Partner {
  id: string
  name: string
  legalName: string | null
  inn: string | null
  phone: string | null
  email: string | null
  contactPerson: string | null
  billingStatus: string
  createdAt: string
  branches: { id: string; name: string }[]
  employees: { id: string; firstName: string; lastName: string; email: string | null }[]
  billingSubscriptions: { id: string; status: string; monthlyAmount: string; plan: { name: string } }[]
  _count: { employees: number; clients: number; branches: number }
}

const BILLING_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  grace_period: { label: "Грейс", variant: "secondary" },
  blocked: { label: "Заблокирован", variant: "destructive" },
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: "", legalName: "", inn: "", phone: "", email: "", contactPerson: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const fetchPartners = () => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then(setPartners)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPartners() }, [])

  const handleCreate = async () => {
    setError("")
    setSaving(true)
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setDialogOpen(false)
      setForm({ name: "", legalName: "", inn: "", phone: "", email: "", contactPerson: "" })
      fetchPartners()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Партнёры</h1>
          <p className="text-sm text-muted-foreground">Управление организациями-партнёрами</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          Добавить партнёра
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Организация</TableHead>
                <TableHead>ИНН</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Филиалы</TableHead>
                <TableHead>Сотрудники</TableHead>
                <TableHead>Клиенты</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => {
                const sub = p.billingSubscriptions[0]
                const owner = p.employees[0]
                const st = BILLING_STATUS_MAP[p.billingStatus] || { label: p.billingStatus, variant: "outline" as const }
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.legalName && <div className="text-xs text-muted-foreground">{p.legalName}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{p.inn || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {owner ? `${owner.lastName} ${owner.firstName}` : "—"}
                    </TableCell>
                    <TableCell>{p._count.branches}</TableCell>
                    <TableCell>{p._count.employees}</TableCell>
                    <TableCell>{p._count.clients}</TableCell>
                    <TableCell className="text-sm">
                      {sub ? (
                        <span>{sub.plan.name} — {Number(sub.monthlyAmount).toLocaleString("ru")} ₽</span>
                      ) : (
                        <span className="text-muted-foreground">Нет подписки</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/partners/${p.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="size-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
              {partners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Нет партнёров
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Диалог создания */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый партнёр</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название организации *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Детский центр «Радуга»" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Юрлицо</Label>
                <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="ООО или ИП" />
              </div>
              <div className="space-y-2">
                <Label>ИНН</Label>
                <Input value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} placeholder="7712345678" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Телефон</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 (999) 000-00-00" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="info@example.com" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Контактное лицо</Label>
              <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="Иванов Иван Иванович" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name}>
              {saving ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
