import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Wallet, Banknote, CreditCard, Globe } from "lucide-react"
import { AddPaymentDialog } from "./add-payment-dialog"

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

export default async function PaymentsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Начало и конец текущего месяца (UTC для корректного сравнения с DATE)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = new Date(Date.UTC(year, month, 1))
  const monthEnd = new Date(Date.UTC(year, month + 1, 0))

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
  const totalIncoming = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const byCash = payments.filter(p => p.method === "cash").reduce((sum, p) => sum + Number(p.amount), 0)
  const byAcquiring = payments.filter(p => p.method === "acquiring" || p.method === "bank_transfer").reduce((sum, p) => sum + Number(p.amount), 0)
  const byOnline = payments.filter(p => ["online_yukassa", "online_robokassa", "sbp_qr"].includes(p.method)).reduce((sum, p) => sum + Number(p.amount), 0)

  const summary = [
    { title: "Поступления", value: totalIncoming, icon: Wallet, color: "text-green-600", bg: "bg-green-50" },
    { title: "Наличные", value: byCash, icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50" },
    { title: "Безнал / Эквайринг", value: byAcquiring, icon: CreditCard, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Онлайн / СБП", value: byOnline, icon: Globe, color: "text-purple-600", bg: "bg-purple-50" },
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

  const monthName = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Оплаты</h1>
        <AddPaymentDialog
          clients={clients.map(c => ({ id: c.id, name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени" }))}
          accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
        />
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
                const subInfo = p.subscription
                  ? `${p.subscription.direction.name} (${String(p.subscription.periodMonth).padStart(2, "0")}.${p.subscription.periodYear})`
                  : p.comment || "—"
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell className="font-medium">{clientName}</TableCell>
                    <TableCell>{subInfo}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatMoney(Number(p.amount))}
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
