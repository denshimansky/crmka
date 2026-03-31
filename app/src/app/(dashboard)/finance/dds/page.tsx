import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default async function DdsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = new Date(Date.UTC(year, month, 1))
  const monthEnd = new Date(Date.UTC(year, month + 1, 0))

  // Все счета
  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, type: true, balance: true },
    orderBy: { createdAt: "asc" },
  })

  // Приход — оплаты за месяц
  const payments = await db.payment.findMany({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    select: { amount: true, method: true, accountId: true },
  })

  // Расход — расходы за месяц
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    include: { category: { select: { name: true } } },
  })

  // Выплаты ЗП за месяц
  const salaryPayments = await db.salaryPayment.findMany({
    where: { tenantId, date: { gte: monthStart, lte: monthEnd } },
    select: { amount: true, accountId: true },
  })

  // Операции между счетами за месяц
  const operations = await db.accountOperation.findMany({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    include: {
      fromAccount: { select: { name: true } },
      toAccount: { select: { name: true } },
    },
  })

  // === Приход ===
  const totalIncome = payments.reduce((s, p) => s + Number(p.amount), 0)
  const METHOD_LABELS: Record<string, string> = {
    cash: "Наличные", bank_transfer: "Безнал", acquiring: "Эквайринг",
    online_yukassa: "ЮKassa", online_robokassa: "Робокасса", sbp_qr: "СБП",
  }
  const incomeByMethod = new Map<string, number>()
  for (const p of payments) {
    const label = METHOD_LABELS[p.method] || p.method
    incomeByMethod.set(label, (incomeByMethod.get(label) || 0) + Number(p.amount))
  }

  // === Расход ===
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const expenseByCategory = new Map<string, number>()
  for (const e of expenses) {
    expenseByCategory.set(e.category.name, (expenseByCategory.get(e.category.name) || 0) + Number(e.amount))
  }

  const totalSalaryPaid = salaryPayments.reduce((s, p) => s + Number(p.amount), 0)
  const totalWithdrawals = operations.filter(o => o.type === "owner_withdrawal").reduce((s, o) => s + Number(o.amount), 0)
  const totalEncashments = operations.filter(o => o.type === "encashment").reduce((s, o) => s + Number(o.amount), 0)

  const totalOutflow = totalExpenses + totalSalaryPaid + totalWithdrawals + totalEncashments

  // === Остатки ===
  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0)

  const monthName = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Строки расхода для таблицы
  const expenseRows = [
    ...Array.from(expenseByCategory.entries()).map(([name, amount]) => ({ name, amount })),
    ...(totalSalaryPaid > 0 ? [{ name: "Выплаты ЗП", amount: totalSalaryPaid }] : []),
    ...(totalWithdrawals > 0 ? [{ name: "Выемки собственника", amount: totalWithdrawals }] : []),
    ...(totalEncashments > 0 ? [{ name: "Инкассации", amount: totalEncashments }] : []),
  ].sort((a, b) => b.amount - a.amount)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ДДС</h1>
        <p className="text-sm text-muted-foreground">Движение денежных средств</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-50">
              <ArrowDownCircle className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Приход</p>
              <p className="text-lg font-bold text-green-600">{formatMoney(totalIncome)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
              <ArrowUpCircle className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Расход</p>
              <p className="text-lg font-bold text-red-600">{formatMoney(totalOutflow)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50">
              <Wallet className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Остаток на счетах</p>
              <p className="text-lg font-bold">{formatMoney(totalBalance)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Приход */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-green-700">Приход</CardTitle>
          </CardHeader>
          <CardContent>
            {incomeByMethod.size === 0 ? (
              <p className="text-sm text-muted-foreground">Нет поступлений</p>
            ) : (
              <Table>
                <TableBody>
                  {Array.from(incomeByMethod.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([method, amount]) => (
                    <TableRow key={method}>
                      <TableCell>{method}</TableCell>
                      <TableCell className="text-right font-medium text-green-600">{formatMoney(amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell>Итого приход</TableCell>
                    <TableCell className="text-right text-green-700">{formatMoney(totalIncome)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Расход */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-700">Расход</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет расходов</p>
            ) : (
              <Table>
                <TableBody>
                  {expenseRows.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-right font-medium text-red-600">{formatMoney(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell>Итого расход</TableCell>
                    <TableCell className="text-right text-red-700">{formatMoney(totalOutflow)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Остатки по счетам */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Остатки по счетам</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет счетов</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Счёт</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <Badge variant="outline">
                        {{ cash: "Касса", bank_account: "Р/С", acquiring: "Эквайринг", online: "Онлайн" }[a.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${Number(a.balance) >= 0 ? "" : "text-red-600"}`}>
                      {formatMoney(Number(a.balance))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>Итого</TableCell>
                  <TableCell className="text-right">{formatMoney(totalBalance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Операции между счетами */}
      {operations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Перемещения и операции</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Тип</TableHead>
                  <TableHead>Откуда</TableHead>
                  <TableHead>Куда</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {{ owner_withdrawal: "Выемка", encashment: "Инкассация", transfer: "Перевод" }[op.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>{op.fromAccount?.name || "—"}</TableCell>
                    <TableCell>{op.toAccount?.name || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(Number(op.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
