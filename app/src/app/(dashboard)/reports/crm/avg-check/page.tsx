import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Банковский перевод",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП (QR)",
}

export default async function AvgCheckReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "incoming",
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { amount: true, method: true },
  })

  const totalAmount = payments.reduce((s, p) => s + Number(p.amount), 0)
  const totalCount = payments.length
  const avgCheck = totalCount > 0 ? totalAmount / totalCount : 0

  // Группировка по способу оплаты
  const byMethod = new Map<string, { amount: number; count: number }>()
  for (const p of payments) {
    const prev = byMethod.get(p.method) || { amount: 0, count: 0 }
    prev.amount += Number(p.amount)
    prev.count += 1
    byMethod.set(p.method, prev)
  }

  const methodRows = Array.from(byMethod.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([method, data]) => ({
      method,
      label: METHOD_LABELS[method] || method,
      amount: data.amount,
      count: data.count,
      avg: data.count > 0 ? data.amount / data.count : 0,
    }))

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Средний чек</h1>
            <PageHelp pageKey="reports/crm/avg-check" />
          </div>
          <p className="text-sm text-muted-foreground">Средняя сумма оплаты по способам</p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Средний чек</p>
            <p className="text-2xl font-bold">{formatMoney(avgCheck)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Оплат за месяц</p>
            <p className="text-2xl font-bold text-blue-600">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Сумма оплат</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(totalAmount)}</p>
          </CardContent>
        </Card>
      </div>

      {methodRows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По способам оплаты</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead className="text-right">Средний чек</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {methodRows.map((r) => (
                    <TableRow key={r.method}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                      <TableCell className="text-right">{formatMoney(r.avg)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
