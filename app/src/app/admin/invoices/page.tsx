"use client"

import { useEffect, useState } from "react"
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
  periodStart: string
  periodEnd: string
  dueDate: string
  paidAt: string | null
  paidAmount: string | null
  organization: { id: string; name: string }
  subscription: { id: string; plan: { name: string } }
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Ожидает", variant: "secondary" },
  paid: { label: "Оплачен", variant: "default" },
  overdue: { label: "Просрочен", variant: "destructive" },
  cancelled: { label: "Отменён", variant: "outline" },
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  const fetchInvoices = () => {
    fetch("/api/admin/invoices")
      .then((r) => r.json())
      .then(setInvoices)
      .catch(console.error)
      .finally(() => setLoading(false))
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Счета</h1>
        <p className="text-sm text-muted-foreground">Все выставленные счета</p>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Номер</TableHead>
                <TableHead>Партнёр</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Оплата до</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const st = STATUS[inv.status] || { label: inv.status, variant: "outline" as const }
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell>
                      <Link href={`/admin/partners/${inv.organization.id}`} className="text-primary hover:underline">
                        {inv.organization.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{inv.subscription.plan.name}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(inv.periodStart).toLocaleDateString("ru")} — {new Date(inv.periodEnd).toLocaleDateString("ru")}
                    </TableCell>
                    <TableCell>{Number(inv.amount).toLocaleString("ru")} ₽</TableCell>
                    <TableCell className="text-sm">{new Date(inv.dueDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    <TableCell>
                      {inv.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleStatus(inv.id, "paid")}>Оплачен</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleStatus(inv.id, "cancelled")}>Отменить</Button>
                        </div>
                      )}
                      {inv.status === "overdue" && (
                        <Button size="sm" variant="outline" onClick={() => handleStatus(inv.id, "paid")}>Оплачен</Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {invoices.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Нет счетов</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
