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
  ArrowLeft, Building2, CalendarClock, CircleSlash, CreditCard, FileText, KeyRound, LogIn, Pencil, Plus, Users,
} from "lucide-react"
import { BackButton } from "@/components/back-button"

interface Plan {
  id: string
  name: string
  pricePerBranch: string
  priceTiers: Record<string, number> | null
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
  trialEndsAt: string | null
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
  billingExempt: boolean
  createdAt: string
  branches: { id: string; name: string; address: string | null }[]
  employees: { id: string; firstName: string; lastName: string; role: string; email: string | null; phone: string | null; isActive: boolean }[]
  billingSubscriptions: Subscription[]
  billingInvoices: Invoice[]
  _count: { employees: number; clients: number; branches: number }
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  trial: { label: "Тестовый период", variant: "secondary" },
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
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [changePlanForm, setChangePlanForm] = useState({ subscriptionId: "", planId: "", branchCount: "1" })
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendForm, setExtendForm] = useState({ subscriptionId: "", trialEndsAt: "" })
  const [extending, setExtending] = useState(false)
  const [zeroing, setZeroing] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [invoiceForm, setInvoiceForm] = useState({ subscriptionId: "", periodStart: "", periodEnd: "", dueDate: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [impersonating, setImpersonating] = useState(false)
  const [resetInfo, setResetInfo] = useState<{ url: string; name: string; emailSent: boolean } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetCopied, setResetCopied] = useState(false)

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

  // Сменить тариф действующей подписки: меняем план и/или число филиалов,
  // сумма/мес пересчитывается на сервере по сетке выбранного тарифа.
  const openChangePlan = (s: Subscription) => {
    setChangePlanForm({ subscriptionId: s.id, planId: s.plan.id, branchCount: String(s.branchCount) })
    setError("")
    setChangePlanOpen(true)
  }

  const handleChangePlan = async () => {
    setError("")
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/subscriptions/${changePlanForm.subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: changePlanForm.planId,
          branchCount: parseInt(changePlanForm.branchCount) || 1,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setChangePlanOpen(false)
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setSaving(false) }
  }

  // Продлить тест: сдвигаем конец теста на новую дату (сервер пересчитает якорь и
  // срок первой оплаты, отменит неоплаченный триальный счёт). Кнопка есть только
  // пока подписка в статусе trial.
  const openExtendTrial = (s: Subscription) => {
    setExtendForm({
      subscriptionId: s.id,
      trialEndsAt: s.trialEndsAt ? s.trialEndsAt.slice(0, 10) : "",
    })
    setError("")
    setExtendOpen(true)
  }

  const handleExtendTrial = async () => {
    setError("")
    setExtending(true)
    try {
      const res = await fetch(`/api/admin/partners/${id}/extend-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: extendForm.trialEndsAt }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); return }
      setExtendOpen(false)
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setExtending(false) }
  }

  // Обнулить тариф: перевод внутренней/тестовой базы на нулевой план (0 ₽) +
  // отключение автосчетов — организация уходит из MRR и прогнозов бэк-офиса.
  const handleZeroTariff = async () => {
    if (!partner) return
    if (!confirm("Перевести партнёра на нулевой тариф (0 ₽) и отключить автосчета? База перестанет учитываться в MRR и прогнозах. Тариф позже можно вернуть кнопкой «Сменить тариф».")) return
    setZeroing(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/partners/${id}/zero-tariff`, { method: "POST" })
      if (!res.ok) { const d = await res.json(); setError(d.error || "Не удалось обнулить тариф"); return }
      fetchPartner()
    } catch { setError("Ошибка сети") }
    finally { setZeroing(false) }
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

  // Ссылка сброса пароля (на случай «владелец забыл пароль»): токен на 1 час,
  // ссылку показываем админу — передать партнёру; письмо уходит само, если
  // настроен SMTP и у сотрудника есть email
  const handleResetPassword = async (employeeId: string) => {
    setError("")
    try {
      const res = await fetch(`/api/admin/partners/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || "Не удалось создать ссылку"); return }
      setResetInfo({ url: d.resetUrl, name: d.employee?.name || "", emailSent: !!d.emailSent })
      setResetCopied(false)
      setResetOpen(true)
    } catch { setError("Ошибка сети") }
  }

  // Исключение из автобиллинга: счета 20-го числа и автоблокировка 1-го
  // не применяются (своя/тестовая организация)
  const handleExemptToggle = async () => {
    if (!partner) return
    await fetch(`/api/admin/partners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingExempt: !partner.billingExempt }),
    })
    fetchPartner()
  }

  const handleImpersonate = async () => {
    setImpersonating(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/partners/${id}/impersonate`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error || `Ошибка impersonation: HTTP ${res.status}`)
        return
      }
      // Cookie установлена — открываем CRM в новой вкладке
      window.open("/", "_blank")
    } catch (e) {
      setError(`Ошибка сети: ${e instanceof Error ? e.message : "неизвестная"}`)
    } finally {
      setImpersonating(false)
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!partner) return <div className="p-6 text-destructive">Партнёр не найден</div>

  const activeSub = partner.billingSubscriptions[0]
  const st = STATUS_MAP[partner.billingStatus] || { label: partner.billingStatus, variant: "outline" as const }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 gap-y-3">
        <BackButton fallbackHref="/admin/partners">
          <Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
        </BackButton>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3 gap-y-2">
            <h1 className="text-2xl font-bold">{partner.name}</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
            {partner.billingExempt && <Badge variant="outline">Без автосчетов</Badge>}
          </div>
          {partner.legalName && <p className="text-sm text-muted-foreground">{partner.legalName}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={handleImpersonate} disabled={impersonating}>
          <LogIn className="mr-2 size-4" />{impersonating ? "Вход..." : "Войти как партнёр"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-2 size-4" />Редактировать
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExemptToggle}
          title="Автовыставление счетов 20-го числа и автоблокировка 1-го"
        >
          {partner.billingExempt ? "Включить автосчета" : "Отключить автосчета"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleZeroTariff}
          disabled={zeroing}
          title="Нулевой тариф 0 ₽ + отключить автосчета — для внутренних/тестовых баз (не учитываются в MRR и прогнозах)"
        >
          <CircleSlash className="mr-2 size-4" />{zeroing ? "Обнуление..." : "Обнулить тариф"}
        </Button>
        <Button
          variant={partner.billingStatus === "blocked" ? "default" : "destructive"}
          size="sm"
          onClick={handleBlockToggle}
        >
          {partner.billingStatus === "blocked" ? "Разблокировать" : "Заблокировать"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                    {e.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        title="Ссылка для сброса пароля"
                        onClick={() => handleResetPassword(e.id)}
                      >
                        <KeyRound className="size-3.5" />
                      </Button>
                    )}
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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2">
          <CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />Подписки</CardTitle>
          <Button size="sm" onClick={() => setSubOpen(true)}>
            <Plus className="mr-2 size-4" />Создать подписку
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тариф</TableHead>
                <TableHead>Филиалов</TableHead>
                <TableHead>Сумма/мес</TableHead>
                <TableHead>Следующая оплата</TableHead>
                <TableHead>Дата начала</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partner.billingSubscriptions.map((s) => {
                const ss = STATUS_MAP[s.status] || { label: s.status, variant: "outline" as const }
                // Продлевать можно неоплаченный тест (в т.ч. просроченный —
                // grace/blocked), но не конвертированный (есть оплаченный счёт).
                const isUnpaidTrial =
                  !!s.trialEndsAt &&
                  s.status !== "cancelled" &&
                  !s.invoices.some((i) => i.status === "paid")
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.plan.name}</TableCell>
                    <TableCell>{s.branchCount}</TableCell>
                    <TableCell>{Number(s.monthlyAmount).toLocaleString("ru")} ₽</TableCell>
                    <TableCell>{new Date(s.nextPaymentDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell>{new Date(s.startDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell><Badge variant={ss.variant}>{ss.label}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isUnpaidTrial && (
                          <Button size="sm" variant="outline" onClick={() => openExtendTrial(s)}>
                            <CalendarClock className="mr-2 size-3.5" />Продлить тест
                          </Button>
                        )}
                        {s.status !== "cancelled" && (
                          <Button size="sm" variant="outline" onClick={() => openChangePlan(s)}>
                            <Pencil className="mr-2 size-3.5" />Сменить тариф
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {partner.billingSubscriptions.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">Нет подписок</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Счета */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2">
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
        <CardContent className="overflow-x-auto">
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
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Открыть PDF счёта"
                          onClick={() => window.open(`/api/admin/invoices/${inv.id}/pdf`, "_blank")}
                        >
                          <FileText className="size-4" />
                        </Button>
                        {inv.status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleInvoiceStatus(inv.id, "paid")}>
                              Оплачен
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleInvoiceStatus(inv.id, "cancelled")}>
                              Отменить
                            </Button>
                          </>
                        )}
                        {inv.status === "overdue" && (
                          <Button size="sm" variant="outline" onClick={() => handleInvoiceStatus(inv.id, "paid")}>
                            Оплачен
                          </Button>
                        )}
                      </div>
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
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.priceTiers && Object.keys(p.priceTiers).length
                        ? `от ${Math.min(...Object.values(p.priceTiers)).toLocaleString("ru")} ₽/мес (сетка)`
                        : `${Number(p.pricePerBranch).toLocaleString("ru")} ₽/филиал`}
                    </SelectItem>
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

      {/* Диалог смены тарифа действующей подписки */}
      <Dialog open={changePlanOpen} onOpenChange={setChangePlanOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Сменить тариф</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Тарифный план *</Label>
              <Select value={changePlanForm.planId} onValueChange={(v) => setChangePlanForm({ ...changePlanForm, planId: v || "" })}>
                <SelectTrigger>
                  {changePlanForm.planId ? plans.find((p) => p.id === changePlanForm.planId)?.name : <span className="text-muted-foreground">Выберите план</span>}
                </SelectTrigger>
                <SelectContent>
                  {plans.filter((p) => (p as any).isActive !== false).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.priceTiers && Object.keys(p.priceTiers).length
                        ? `от ${Math.min(...Object.values(p.priceTiers)).toLocaleString("ru")} ₽/мес (сетка)`
                        : `${Number(p.pricePerBranch).toLocaleString("ru")} ₽/филиал`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Кол-во филиалов</Label>
              <Input type="number" min={1} value={changePlanForm.branchCount} onChange={(e) => setChangePlanForm({ ...changePlanForm, branchCount: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Сумма/мес пересчитается по сетке выбранного тарифа. Для внутренних/тестовых
              баз выберите нулевой тариф (0 ₽) — или используйте кнопку «Обнулить тариф».
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePlanOpen(false)}>Отмена</Button>
            <Button onClick={handleChangePlan} disabled={saving || !changePlanForm.planId}>{saving ? "Сохранение..." : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог продления теста */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Продлить тестовый период</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Новый конец теста</Label>
              <Input
                type="date"
                value={extendForm.trialEndsAt}
                onChange={(e) => setExtendForm({ ...extendForm, trialEndsAt: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              День-якорь и срок первой оплаты сдвинутся на новую дату. Неоплаченный
              триальный счёт (если уже выставлен) будет отменён — новый выставится
              автоматически за 2 дня до нового конца теста.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)}>Отмена</Button>
            <Button onClick={handleExtendTrial} disabled={extending || !extendForm.trialEndsAt}>
              {extending ? "Сохранение..." : "Продлить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог ссылки сброса пароля */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сброс пароля{resetInfo?.name ? `: ${resetInfo.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ссылка действует 1 час. Передайте её сотруднику любым удобным способом —
              по ней он задаст себе новый пароль.
              {resetInfo?.emailSent && " Письмо со ссылкой также отправлено на email."}
            </p>
            <div className="flex gap-2">
              <Input readOnly value={resetInfo?.url || ""} onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(resetInfo?.url || "")
                  setResetCopied(true)
                }}
              >
                {resetCopied ? "Скопировано" : "Копировать"}
              </Button>
            </div>
          </div>
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
