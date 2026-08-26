"use client"

import { Fragment, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import {
  ResizableHead,
  RESIZABLE_TABLE_CLASS,
  useColumnWidths,
} from "@/components/resizable-columns"
import { Plus, Eye, Archive, ArchiveRestore } from "lucide-react"

interface Partner {
  id: string
  name: string
  legalName: string | null
  inn: string | null
  phone: string | null
  email: string | null
  contactPerson: string | null
  billingStatus: string
  archivedAt: string | null
  createdAt: string
  branches: { id: string; name: string }[]
  employees: { id: string; firstName: string; lastName: string; email: string | null }[]
  billingSubscriptions: { id: string; status: string; monthlyAmount: string; plan: { name: string } }[]
  _count: { employees: number; clients: number; branches: number; directions: number; aiChatLogs: number }
  activeSubscriptions: number
}

const BILLING_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  grace_period: { label: "Грейс", variant: "secondary" },
  blocked: { label: "Заблокирован", variant: "destructive" },
}

// Стартовые ширины столбцов (px). Ширину любого можно перетащить за полоску на
// правом крае заголовка — сохраняется в localStorage (модуль resizable-columns).
// «Организация» рассчитана на название; длинное юрлицо под ним обрезается
// многоточием и не растягивает столбец.
const DEFAULT_WIDTHS: Record<string, number> = {
  org: 220,
  inn: 130,
  owner: 170,
  branches: 90,
  employees: 110,
  clients: 90,
  directions: 120,
  subs: 130,
  ai: 110,
  plan: 190,
  status: 120,
  actions: 104,
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: "", legalName: "", inn: "", phone: "", email: "", contactPerson: "", ownerLastName: "", ownerFirstName: "", ownerLogin: "", ownerPassword: "", ownerEmail: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Ширина столбцов: полоска-ручка на правом крае заголовка, localStorage.
  const { widthOf, startResize } = useColumnWidths("admin-partners-colw", DEFAULT_WIDTHS)

  const fetchPartners = () => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then(setPartners)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPartners() }, [])

  // Архивирование партнёра прямо из списка (прекратил работу). Обратимо.
  const handleArchiveToggle = async (p: Partner) => {
    const archiving = !p.archivedAt
    const msg = archiving
      ? `Архивировать «${p.name}»? Счета выставляться перестанут, партнёр уйдёт вниз списка. Действие обратимо.`
      : `Вернуть «${p.name}» из архива? Партнёр снова станет действующим — автосчета возобновятся по расписанию.`
    if (!confirm(msg)) return
    await fetch(`/api/admin/partners/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: archiving }),
    })
    fetchPartners()
  }

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
      setForm({ name: "", legalName: "", inn: "", phone: "", email: "", contactPerson: "", ownerLastName: "", ownerFirstName: "", ownerLogin: "", ownerPassword: "", ownerEmail: "" })
      fetchPartners()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-y-3">
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
        <StickyHScroll className="rounded-md border">
          <Table className={RESIZABLE_TABLE_CLASS}>
            <TableHeader>
              <TableRow>
                <ResizableHead id="org" width={widthOf("org")} onResizeStart={startResize}>Организация</ResizableHead>
                <ResizableHead id="inn" width={widthOf("inn")} onResizeStart={startResize}>ИНН</ResizableHead>
                <ResizableHead id="owner" width={widthOf("owner")} onResizeStart={startResize}>Владелец</ResizableHead>
                <ResizableHead id="branches" width={widthOf("branches")} onResizeStart={startResize}>Филиалы</ResizableHead>
                <ResizableHead id="employees" width={widthOf("employees")} onResizeStart={startResize}>Сотрудники</ResizableHead>
                <ResizableHead id="clients" width={widthOf("clients")} onResizeStart={startResize}>Клиенты</ResizableHead>
                <ResizableHead id="directions" width={widthOf("directions")} onResizeStart={startResize}>Направления</ResizableHead>
                <ResizableHead id="subs" width={widthOf("subs")} onResizeStart={startResize}>Акт. абонементы</ResizableHead>
                <ResizableHead id="ai" width={widthOf("ai")} onResizeStart={startResize}>ИИ-запросы</ResizableHead>
                <ResizableHead id="plan" width={widthOf("plan")} onResizeStart={startResize}>Тариф</ResizableHead>
                <ResizableHead id="status" width={widthOf("status")} onResizeStart={startResize}>Статус</ResizableHead>
                <ResizableHead id="actions" width={widthOf("actions")} onResizeStart={startResize}> </ResizableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p, idx) => {
                const sub = p.billingSubscriptions[0]
                const owner = p.employees[0]
                const st = BILLING_STATUS_MAP[p.billingStatus] || { label: p.billingStatus, variant: "outline" as const }
                const archived = !!p.archivedAt
                // Разделитель «Архив» — перед первым архивным партнёром (список
                // уже отсортирован: действующие сверху, архивные внизу).
                const showArchivedDivider = archived && !partners[idx - 1]?.archivedAt
                return (
                  <Fragment key={p.id}>
                    {showArchivedDivider && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={12} className="py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Архив — {partners.filter((x) => x.archivedAt).length}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className={archived ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="truncate font-medium" title={p.name}>{p.name}</div>
                        {p.legalName && <div className="truncate text-xs text-muted-foreground" title={p.legalName}>{p.legalName}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{p.inn || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {owner ? `${owner.lastName} ${owner.firstName}` : "—"}
                      </TableCell>
                      <TableCell>{p._count.branches}</TableCell>
                      <TableCell>{p._count.employees}</TableCell>
                      <TableCell>{p._count.clients}</TableCell>
                      <TableCell>{p._count.directions}</TableCell>
                      <TableCell>{p.activeSubscriptions}</TableCell>
                      <TableCell>{p._count.aiChatLogs}</TableCell>
                      <TableCell className="text-sm" title={sub ? `${sub.plan.name} — ${Number(sub.monthlyAmount).toLocaleString("ru")} ₽` : ""}>
                        {sub ? (
                          <span>{sub.plan.name} — {Number(sub.monthlyAmount).toLocaleString("ru")} ₽</span>
                        ) : (
                          <span className="text-muted-foreground">Нет подписки</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {archived ? (
                          <Badge variant="outline">Архив</Badge>
                        ) : (
                          <Badge variant={st.variant}>{st.label}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <Link href={`/admin/partners/${p.id}`}>
                            <Button variant="ghost" size="sm" title="Открыть карточку">
                              <Eye className="size-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={archived ? "Вернуть из архива" : "Архивировать"}
                            onClick={() => handleArchiveToggle(p)}
                          >
                            {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                )
              })}
              {partners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Нет партнёров
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </StickyHScroll>
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

            <div className="border-t pt-4 mt-2">
              <p className="text-sm font-medium mb-3">Владелец (owner)</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Фамилия *</Label>
                  <Input value={form.ownerLastName} onChange={(e) => setForm({ ...form, ownerLastName: e.target.value })} placeholder="Малафеева" />
                </div>
                <div className="space-y-2">
                  <Label>Имя *</Label>
                  <Input value={form.ownerFirstName} onChange={(e) => setForm({ ...form, ownerFirstName: e.target.value })} placeholder="Анна" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="space-y-2">
                  <Label>Логин *</Label>
                  <Input value={form.ownerLogin} onChange={(e) => setForm({ ...form, ownerLogin: e.target.value })} placeholder="owner-zvezdochka" />
                </div>
                <div className="space-y-2">
                  <Label>Пароль *</Label>
                  <PasswordInput value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} placeholder="Минимум 6 символов" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <Label>Email владельца</Label>
                <Input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="owner@example.com" />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name || !form.ownerLogin || !form.ownerPassword || !form.ownerFirstName || !form.ownerLastName}>
              {saving ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
