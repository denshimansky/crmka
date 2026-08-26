"use client"

import { Fragment, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import Link from "next/link"

interface Invoice {
  id: string
  number: string
  amount: string
  status: string
  createdAt: string
  periodStart: string
  periodEnd: string
  dueDate: string
  paidAt: string | null
  paidAmount: string | null
  organization: { id: string; name: string; employees: { firstName: string; lastName: string }[] }
  subscription: { id: string; plan: { name: string } }
}

// Русское склонение «счёт / счёта / счетов» для заголовка группы месяца.
function pluralInvoices(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return "счёт"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "счёта"
  return "счетов"
}

// Группировка счетов по месяцу выставления (createdAt). Список приходит с сервера
// отсортированным createdAt desc → месяцы идут от новых к старым; Map сохраняет
// порядок появления, поэтому заголовки месяцев выстраиваются новые сверху.
function groupByIssueMonth(invoices: Invoice[]): { label: string; total: number; items: Invoice[] }[] {
  const map = new Map<string, { label: string; total: number; items: Invoice[] }>()
  for (const inv of invoices) {
    const d = new Date(inv.createdAt)
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`
    let g = map.get(key)
    if (!g) {
      const raw = d.toLocaleDateString("ru", { month: "long", year: "numeric" })
      g = { label: raw.charAt(0).toUpperCase() + raw.slice(1), total: 0, items: [] }
      map.set(key, g)
    }
    g.items.push(inv)
    g.total += Number(inv.amount)
  }
  return [...map.values()]
}

interface BankOperation {
  id: string
  operationId: string
  operationDate: string
  amount: string
  payerName: string | null
  payerInn: string | null
  paymentPurpose: string | null
  comment: string | null
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Ожидает", variant: "secondary" },
  paid: { label: "Оплачен", variant: "default" },
  overdue: { label: "Просрочен", variant: "destructive" },
  cancelled: { label: "Отменён", variant: "outline" },
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [unmatchedOps, setUnmatchedOps] = useState<BankOperation[]>([])
  const [loading, setLoading] = useState(true)

  const fetchInvoices = () => {
    fetch("/api/admin/invoices")
      .then((r) => r.json())
      .then(setInvoices)
      .catch(console.error)
      .finally(() => setLoading(false))
    fetch("/api/admin/bank-operations?status=unmatched")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUnmatchedOps(Array.isArray(d) ? d : []))
      .catch(() => setUnmatchedOps([]))
  }

  useEffect(() => { fetchInvoices() }, [])

  const handleStatus = async (id: string, status: string) => {
    await fetch(`/api/admin/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    fetchInvoices()
  }

  const monthGroups = groupByIssueMonth(invoices)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Счета</h1>
        <p className="text-sm text-muted-foreground">Все выставленные счета, сгруппированы по месяцу выставления</p>
      </div>

      {/* Платежи из выписки Т-Банк, которые не удалось сопоставить со счетами
          автоматически — разбираются вручную: найти счёт и отметить «Оплачен» */}
      {unmatchedOps.length > 0 && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 overflow-x-auto">
          <h2 className="mb-2 font-semibold text-destructive">
            Неразобранные платежи из выписки ({unmatchedOps.length})
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Плательщик</TableHead>
                <TableHead>ИНН</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Назначение</TableHead>
                <TableHead>Причина</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmatchedOps.map((op) => (
                <TableRow key={op.id}>
                  <TableCell className="text-sm">{new Date(op.operationDate).toLocaleDateString("ru")}</TableCell>
                  <TableCell className="text-sm">{op.payerName || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{op.payerInn || "—"}</TableCell>
                  <TableCell>{Number(op.amount).toLocaleString("ru")} ₽</TableCell>
                  <TableCell className="max-w-64 truncate text-sm" title={op.paymentPurpose || ""}>
                    {op.paymentPurpose || "—"}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm" title={op.comment || ""}>
                    {op.comment || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Номер</TableHead>
                <TableHead>Партнёр</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Оплата до</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthGroups.map((g) => (
                <Fragment key={g.label}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={9} className="py-2 text-sm font-semibold">
                      {g.label}
                      <span className="ml-2 font-normal text-muted-foreground">
                        — {g.items.length} {pluralInvoices(g.items.length)} · {g.total.toLocaleString("ru")} ₽
                      </span>
                    </TableCell>
                  </TableRow>
                  {g.items.map((inv) => {
                    const st = STATUS[inv.status] || { label: inv.status, variant: "outline" as const }
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                        <TableCell>
                          <Link href={`/admin/partners/${inv.organization.id}`} className="text-primary hover:underline">
                            {inv.organization.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {inv.organization.employees[0]
                            ? `${inv.organization.employees[0].lastName} ${inv.organization.employees[0].firstName}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{inv.subscription.plan.name}</TableCell>
                        <TableCell className="text-sm">
                          {new Date(inv.periodStart).toLocaleDateString("ru")} — {new Date(inv.periodEnd).toLocaleDateString("ru")}
                        </TableCell>
                        <TableCell>{Number(inv.amount).toLocaleString("ru")} ₽</TableCell>
                        <TableCell className="text-sm">{new Date(inv.dueDate).toLocaleDateString("ru")}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Открыть PDF счёта"
                              onClick={() => window.open(`/api/admin/invoices/${inv.id}/pdf`, "_blank")}
                            >
                              PDF
                            </Button>
                            {inv.status === "pending" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => handleStatus(inv.id, "paid")}>Оплачен</Button>
                                <Button size="sm" variant="ghost" onClick={() => handleStatus(inv.id, "cancelled")}>Отменить</Button>
                              </>
                            )}
                            {inv.status === "overdue" && (
                              <Button size="sm" variant="outline" onClick={() => handleStatus(inv.id, "paid")}>Оплачен</Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
              {invoices.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Нет счетов</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
