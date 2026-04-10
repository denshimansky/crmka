import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Banknote, Building, CreditCard, Globe } from "lucide-react"
import { AddAccountDialog } from "./add-account-dialog"
import { EditAccountDialog } from "./edit-account-dialog"
import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"

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

const OP_TYPE_LABELS: Record<string, string> = {
  owner_withdrawal: "Выемка",
  encashment: "Инкассация",
  transfer: "Перевод",
}

export default async function CashPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const params = await searchParams

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  })

  // Parse month filter (default: current month)
  const now = new Date()
  const filterYear = Number(params.year) || now.getFullYear()
  const filterMonth = Number(params.month) || (now.getMonth() + 1)

  const monthStart = new Date(Date.UTC(filterYear, filterMonth - 1, 1))
  const monthEnd = new Date(Date.UTC(filterYear, filterMonth, 0, 23, 59, 59, 999))

  // Payments for selected month
  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
      account: { select: { id: true, name: true } },
      subscription: {
        select: { direction: { select: { name: true } } },
      },
    },
    orderBy: { date: "desc" },
    take: 100,
  })

  // Account operations for selected month
  const operations = await db.accountOperation.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  })

  // Branches for dialog
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Calculate totals for the month per account
  const monthTotals: Record<string, { incoming: number; outgoing: number }> = {}
  for (const a of accounts) {
    monthTotals[a.id] = { incoming: 0, outgoing: 0 }
  }
  for (const p of payments) {
    if (!monthTotals[p.accountId]) continue
    if (p.type === "incoming" || p.type === "transfer_in") {
      monthTotals[p.accountId].incoming += Number(p.amount)
    } else {
      monthTotals[p.accountId].outgoing += Number(p.amount)
    }
  }

  const monthLabel = new Date(filterYear, filterMonth - 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Касса</h1>
          <PageHelp pageKey="finance/cash" />
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker />
          <AddAccountDialog branches={branches} />
        </div>
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
              const mt = monthTotals[a.id]
              return (
                <Card key={a.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
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
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="shrink-0">{TYPE_LABELS[a.type]}</Badge>
                        <EditAccountDialog
                          account={{ id: a.id, name: a.name, type: a.type, branchId: a.branchId }}
                          branches={branches}
                        />
                      </div>
                    </div>
                    {mt && (mt.incoming > 0 || mt.outgoing > 0) && (
                      <div className="mt-2 flex gap-3 text-xs">
                        {mt.incoming > 0 && <span className="text-green-600">+{formatMoney(mt.incoming)}</span>}
                        {mt.outgoing > 0 && <span className="text-red-600">−{formatMoney(mt.outgoing)}</span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Payments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Оплаты за {monthLabel}
                {payments.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{payments.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Нет оплат за {monthLabel}
                </p>
              ) : (
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
                      const clientName = [p.client.lastName, p.client.firstName].filter(Boolean).join(" ") || "—"
                      const dateStr = p.date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                      const isPositive = p.type === "incoming" || p.type === "transfer_in"
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="text-muted-foreground">{dateStr}</TableCell>
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

          {/* Account operations */}
          {operations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Операции между счетами
                  <Badge variant="secondary" className="ml-2">{operations.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Откуда</TableHead>
                      <TableHead>Куда</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Описание</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operations.map((op) => {
                      const dateStr = op.date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                      return (
                        <TableRow key={op.id}>
                          <TableCell className="text-muted-foreground">{dateStr}</TableCell>
                          <TableCell>
                            <Badge variant={op.type === "owner_withdrawal" ? "destructive" : "secondary"}>
                              {OP_TYPE_LABELS[op.type] || op.type}
                            </Badge>
                          </TableCell>
                          <TableCell>{op.fromAccount?.name || "—"}</TableCell>
                          <TableCell>{op.toAccount?.name || "—"}</TableCell>
                          <TableCell className="text-right font-medium">{formatMoney(Number(op.amount))}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">{op.description || "—"}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
