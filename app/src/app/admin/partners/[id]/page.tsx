"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  ArrowLeft, Building2, CreditCard, FileText, Pencil, Plus, Users,
} from "lucide-react"
import Link from "next/link"

interface Plan {
  id: string
  name: string
  pricePerBranch: string
}

interface Invoice {
  id: string
  number: string
  amount: string
  status: string
  periodStart: string
  periodEnd: string
  dueDate: string
  paidAt: string | null
  paidAmount: string | null
  comment: string | null
}

interface Subscription {
  id: string
  status: string
  branchCount: number
  monthlyAmount: string
  nextPaymentDate: string
  startDate: string
  plan: Plan
  invoices: Invoice[]
}

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
  branches: { id: string; name: string; address: string | null }[]
  employees: { id: string; firstName: string; lastName: string; role: string; email: string | null; phone: string | null; isActive: boolean }[]
  billingSubscriptions: Subscription[]
  billingInvoices: Invoice[]
  _count: { employees: number; clients: number; branches: number }
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  grace_period: { label: "Грейс-период", variant: "secondary" },
  blocked: { label: "Заблокирован", variant: "destructive" },
  cancelled: { label: "Отменена", variant: "outline" },
}

const INVOICE_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Ожидает", variant: "secondary" },
  paid: { label: "Оплачен", variant: "default" },
  overdue: { label: "Просрочен", variant: "destructive" },
  cancelled: { label: "Отменён", variant: "outline" },
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [partner, setPartner] = useState<Partner | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  // Диалоги
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: "", legalName: "", inn: "", phone: "", email: "", contactPerson: "" })
  const [subOpen, setSubOpen] = useState(false)
  const [subForm, setSubForm] = useState({ planId: "", branchCount: "1", startDate: new Date().toISOString().slice(0, 10) })
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [invoiceForm, setInvoiceForm] = useState({ subscriptionId: "", periodStart: "", periodEnd: "", dueDate: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const fetchPartner = () => {
    fetch(`/api/admin/partners/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPartner(data)
        setEditForm({
          name: data.name || "",
          legalName: data.legalName || "",
          inn: data.inn || "",
          phone: data.phone || "",
          email: data.email || "",
          contactPerson: data.contactPerson || "",
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchPartner()
    fetch("/api/admin/plans").then((r) => r.json()).then(setPlans).catch(console.error)
  }, [id])

  const handleEdit = async () => {
    setError("")
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setEditOpen(false)
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setSaving(false) }
  }

  const handleCreateSub = async () => {
    setError("")
    setSaving(true)
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: id,
          planId: subForm.planId,
          branchCount: parseInt(subForm.branchCount),
          startDate: subForm.startDate,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setSubOpen(false)
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setSaving(false) }
  }

  const handleCreateInvoice = async () => {
    setError("")
    setSaving(true)
    try {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoiceForm),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setInvoiceOpen(false)
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setSaving(false) }
  }

  const handleInvoiceStatus = async (invoiceId: string, status: string) => {
    await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    fetchPartner()
  }

  const handleBlockToggle = async () => {
    if (!partner) return
    const newStatus = partner.billingStatus === "blocked" ? "active" : "blocked"
    await fetch(`/api/admin/partners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingStatus: newStatus }),
    })
    // Также обновляем подписку
    const activeSub = partner.billingSubscriptions[0]
    if (activeSub) {
      await fetch(`/api/admin/subscriptions/${activeSub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
    }
    fetchPartner()
  }

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!partner) return <div className="p-6 text-destructive">Партнёр не найден</div>

  const activeSub = partner.billingSubscriptions[0]
  const st = STATUS_MAP[partner.billingStatus] || { label: partner.billingStatus, variant: "outline" as const }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/partners">
          <Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{partner.name}</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          {partner.legalName && <p className="text-sm text-muted-foreground">{partner.legalName}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-2 size-4" />Редактировать
        </Button>
        <Button
          variant={partner.billingStatus === "blocked" ? "default" : "destructive"}
          size="sm"
          onClick={handleBlockToggle}
        >
          {partner.billingStatus === "blocked" ? "Разблокировать" : "Заблокировать"}
        </Button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Филиалы</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{partner._count.branches}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Сотрудники</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{partner._count.employees}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Клиенты</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{partner._count.clients}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Тариф</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeSub ? `${Number(activeSub.monthlyAmount).toLocaleString("ru")} ₽` : "—"}
            </div>
            {activeSub && <div className="text-xs text-muted-foreground">{activeSub.plan.name}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="size-4" />Реквизиты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">ИНН:</span> <span>{partner.inn || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Телефон:</span> <span>{partner.phone || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email:</span> <span>{partner.email || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Контакт:</span> <span>{partner.contactPerson || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Подключён:</span> <span>{new Date(partner.createdAt).toLocaleDateString("ru")}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="size-4" />Сотрудники</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {partner.employees.map((e) => (
                <div key={e.id} className="flex items-center justify-between">
                  <span>{e.lastName} {e.firstName}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{e.role}</Badge>
                    {!e.isActive && <Badge variant="destructive" className="text-xs">Неактивен</Badge>}
                  </div>
                </div>
              ))}
              {partner.employees.length === 0 && <p className="text-muted-foreground">Нет сотрудников</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Подписки */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />Подписки</CardTitle>
          <Button size="sm" onClick={() => setSubOpen(true)}>
            <Plus className="mr-2 size-4" />Создать подписку
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тариф</TableHead>
                <TableHead>Филиалов</TableHead>
                <TableHead>Сумма/мес</TableHead>
                <TableHead>Следующая оплата</TableHead>
                <TableHead>Дата начала</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partner.billingSubscriptions.map((s) => {
                const ss = STATUS_MAP[s.status] || { label: s.status, variant: "outline" as const }
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.plan.name}</TableCell>
                    <TableCell>{s.branchCount}</TableCell>
                    <TableCell>{Number(s.monthlyAmount).toLocaleString("ru")} ₽</TableCell>
                    <TableCell>{new Date(s.nextPaymentDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell>{new Date(s.startDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell><Badge variant={ss.variant}>{ss.label}</Badge></TableCell>
                  </TableRow>
                )
              })}
              {partner.billingSubscriptions.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">Нет подписок</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Счета */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="size-4" />Счета</CardTitle>
          {activeSub && (
            <Button size="sm" onClick={() => {
              const now = new Date()
              const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
              const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))
              const due = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
              setInvoiceForm({
                subscriptionId: activeSub.id,
                periodStart: start.toISOString().slice(0, 10),
                periodEnd: end.toISOString().slice(0, 10),
                dueDate: due.toISOString().slice(0, 10),
              })
              setInvoiceOpen(true)
            }}>
              <Plus className="mr-2 size-4" />Выставить счёт
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Номер</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Оплата до</TableHead>
                <TableHead>Оплачен</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partner.billingInvoices.map((inv) => {
                const is = INVOICE_STATUS[inv.status] || { label: inv.status, variant: "outline" as const }
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(inv.periodStart).toLocaleDateString("ru")} — {new Date(inv.periodEnd).toLocaleDateString("ru")}
                    </TableCell>
                    <TableCell>{Number(inv.amount).toLocaleString("ru")} ₽</TableCell>
                    <TableCell className="text-sm">{new Date(inv.dueDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell className="text-sm">
                      {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString("ru") : "—"}
                    </TableCell>
                    <TableCell><Badge variant={is.variant}>{is.label}</Badge></TableCell>
                    <TableCell>
                      {inv.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleInvoiceStatus(inv.id, "paid")}>
                            Оплачен
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleInvoiceStatus(inv.id, "cancelled")}>
                            Отменить
                          </Button>
                        </div>
                      )}
                      {inv.status === "overdue" && (
                        <Button size="sm" variant="outline" onClick={() => handleInvoiceStatus(inv.id, "paid")}>
                          Оплачен
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {partner.billingInvoices.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">Нет счетов</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Диалог редактирования */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Редактировать партнёра</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Название *</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Юрлицо</Label><Input value={editForm.legalName} onChange={(e) => setEditForm({ ...editForm, legalName: e.target.value })} /></div>
              <div className="space-y-2"><Label>ИНН</Label><Input value={editForm.inn} onChange={(e) => setEditForm({ ...editForm, inn: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Телефон</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Контактное лицо</Label><Input value={editForm.contactPerson} onChange={(e) => setEditForm({ ...editForm, contactPerson: e.target.value })} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог подписки */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новая подписка</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Тарифный план *</Label>
              <Select value={subForm.planId} onValueChange={(v) => setSubForm({ ...subForm, planId: v || "" })}>
                <SelectTrigger>
                  {subForm.planId ? plans.find((p) => p.id === subForm.planId)?.name : <span className="text-muted-foreground">Выберите план</span>}
                </SelectTrigger>
                <SelectContent>
                  {plans.filter((p) => (p as any).isActive !== false).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {Number(p.pricePerBranch).toLocaleString("ru")} ₽/филиал</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Кол-во филиалов</Label>
                <Input type="number" min={1} value={subForm.branchCount} onChange={(e) => setSubForm({ ...subForm, branchCount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Дата начала</Label>
                <Input type="date" value={subForm.startDate} onChange={(e) => setSubForm({ ...subForm, startDate: e.target.value })} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)}>Отмена</Button>
            <Button onClick={handleCreateSub} disabled={saving || !subForm.planId}>{saving ? "Создание..." : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог счёта */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Выставить счёт</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Период с</Label><Input type="date" value={invoiceForm.periodStart} onChange={(e) => setInvoiceForm({ ...invoiceForm, periodStart: e.target.value })} /></div>
              <div className="space-y-2"><Label>Период по</Label><Input type="date" value={invoiceForm.periodEnd} onChange={(e) => setInvoiceForm({ ...invoiceForm, periodEnd: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Оплата до</Label><Input type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Отмена</Button>
            <Button onClick={handleCreateInvoice} disabled={saving}>{saving ? "Создание..." : "Выставить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
