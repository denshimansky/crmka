import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Wallet, Banknote, CreditCard, Undo2 } from "lucide-react"
import { AddPaymentDialog } from "./add-payment-dialog"
import { RefundPaymentDialog } from "./refund-payment-dialog"
import { PageHelp } from "@/components/page-help"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Начало и конец месяца (UTC для корректного сравнения с DATE)
  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      subscription: {
        select: {
          id: true,
          periodYear: true,
          periodMonth: true,
          direction: { select: { name: true } },
        },
      },
      account: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  })

  // Считаем суммы
  const incomingPayments = payments.filter(p => p.type !== "refund")
  const refundPayments = payments.filter(p => p.type === "refund")
  const totalIncoming = incomingPayments.reduce((sum, p) => sum + Number(p.amount), 0)
  const totalRefunds = refundPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0)
  const byCash = incomingPayments.filter(p => p.method === "cash").reduce((sum, p) => sum + Number(p.amount), 0)
  const byAcquiring = incomingPayments.filter(p => p.method === "acquiring" || p.method === "bank_transfer").reduce((sum, p) => sum + Number(p.amount), 0)
  const byOnline = incomingPayments.filter(p => ["online_yukassa", "online_robokassa", "sbp_qr"].includes(p.method)).reduce((sum, p) => sum + Number(p.amount), 0)

  const summary = [
    { title: "Поступления", value: totalIncoming, icon: Wallet, color: "text-green-600", bg: "bg-green-50" },
    { title: "Возвраты", value: totalRefunds, icon: Undo2, color: "text-red-600", bg: "bg-red-50" },
    { title: "Наличные", value: byCash, icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50" },
    { title: "Безнал / Эквайринг", value: byAcquiring, icon: CreditCard, color: "text-blue-600", bg: "bg-blue-50" },
  ]

  // Данные для диалога
  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
    take: 500,
  })

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: "asc" },
  })

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Оплаты</h1>
          <PageHelp pageKey="finance/payments" />
          <MonthPicker />
        </div>
        <div className="flex gap-2">
          <RefundPaymentDialog
            clients={clients.map(c => ({ id: c.id, name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени" }))}
            accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
          />
          <AddPaymentDialog
            clients={clients.map(c => ({ id: c.id, name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени" }))}
            accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-lg font-bold">{formatMoney(s.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {payments.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет оплат за текущий месяц
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Назначение</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Способ</TableHead>
                <TableHead>Счёт</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => {
                const clientName = [p.client.lastName, p.client.firstName].filter(Boolean).join(" ") || "Без имени"
                const isRefund = p.type === "refund"
                const subInfo = p.subscription
                  ? `${p.subscription.direction.name} (${String(p.subscription.periodMonth).padStart(2, "0")}.${p.subscription.periodYear})`
                  : p.comment || "—"
                const amt = Number(p.amount)
                return (
                  <TableRow key={p.id} className={isRefund ? "bg-red-50/50 dark:bg-red-950/10" : undefined}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell className="font-medium">
                      {clientName}
                      {isRefund && (
                        <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Возврат</Badge>
                      )}
                    </TableCell>
                    <TableCell>{subInfo}</TableCell>
                    <TableCell className={`text-right font-medium ${isRefund ? "text-red-600" : "text-green-600"}`}>
                      {isRefund ? `−${formatMoney(Math.abs(amt))}` : formatMoney(amt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{METHOD_LABELS[p.method] || p.method}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.account.name}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
