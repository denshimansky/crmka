"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface PaymentRow {
  id: string
  amount: number
  date: string
  employeeName: string
  accountName: string
  isOklad: boolean
  okladAmount: number
  pieceAmount: number
}

export function ConductedPaymentsList({ year, month, kind }: { year: number; month: number; kind: "salary" | "piece" }) {
  const router = useRouter()
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // Сумма по типу вкладки (смешанная выплата показывает свою часть; аннул удаляет
  // выплату целиком).
  const tabAmount = (r: PaymentRow) => (kind === "salary" ? r.okladAmount : r.pieceAmount)

  useEffect(() => {
    fetch(`/api/salary-payments?year=${year}&month=${month}&kind=${kind}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => setRows([]))
  }, [year, month, kind])

  async function annul(id: string) {
    if (!confirm("Аннулировать выплату? Деньги вернутся на счёт, расход в Финрез (P&L) снимется.")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/salary-payments/${id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Ошибка"); return }
      router.refresh()
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally { setBusy(null) }
  }

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Проведённые выплаты за период</CardTitle></CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Счёт</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.accountName}</TableCell>
                  <TableCell className="text-right">{new Intl.NumberFormat("ru-RU").format(tabAmount(r))}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => annul(r.id)}>
                      Аннулировать
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
