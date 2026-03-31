import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Banknote, Building, CreditCard, Globe } from "lucide-react"
import { AddAccountDialog } from "./add-account-dialog"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

const TYPE_LABELS: Record<string, string> = {
  cash: "Касса",
  bank_account: "Расчётный счёт",
  acquiring: "Эквайринг",
  online: "Онлайн",
}

const TYPE_ICONS: Record<string, { icon: typeof Banknote; color: string; bg: string }> = {
  cash: { icon: Banknote, color: "text-green-600", bg: "bg-green-50" },
  bank_account: { icon: Building, color: "text-blue-600", bg: "bg-blue-50" },
  acquiring: { icon: CreditCard, color: "text-purple-600", bg: "bg-purple-50" },
  online: { icon: Globe, color: "text-orange-600", bg: "bg-orange-50" },
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

export default async function CashPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  })

  // Оплаты за сегодня
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const todayPayments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: todayStart, lte: todayEnd },
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
      account: { select: { name: true } },
      subscription: {
        select: { direction: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  // Данные для диалога создания счёта
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Касса</h1>
        <AddAccountDialog branches={branches} />
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-muted-foreground">
            <p>Создайте счета для учёта денежных средств</p>
            <AddAccountDialog branches={branches} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.map((a) => {
              const typeInfo = TYPE_ICONS[a.type] || TYPE_ICONS.cash
              const Icon = typeInfo.icon
              const balance = Number(a.balance)
              return (
                <Card key={a.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className={`flex size-10 items-center justify-center rounded-lg ${typeInfo.bg}`}>
                      <Icon className={`size-5 ${typeInfo.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground truncate">
                        {a.name}
                        {a.branch ? ` · ${a.branch.name}` : ""}
                      </p>
                      <p className={`text-lg font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatMoney(balance)}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{TYPE_LABELS[a.type]}</Badge>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Операции за сегодня</CardTitle>
            </CardHeader>
            <CardContent>
              {todayPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Нет операций за сегодня
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Время</TableHead>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Назначение</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Способ</TableHead>
                      <TableHead>Счёт</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todayPayments.map((p) => {
                      const clientName = [p.client.lastName, p.client.firstName].filter(Boolean).join(" ") || "—"
                      const time = p.createdAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                      const isPositive = p.type === "incoming" || p.type === "transfer_in"
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="text-muted-foreground">{time}</TableCell>
                          <TableCell className="font-medium">{clientName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.subscription?.direction?.name || p.comment || "Оплата"}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${isPositive ? "text-green-600" : "text-red-600"}`}>
                            {isPositive ? "+" : "−"}{formatMoney(Number(p.amount))}
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
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
