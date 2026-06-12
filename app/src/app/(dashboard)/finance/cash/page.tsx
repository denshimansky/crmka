import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import {
  scopeBranch,
  scopeFinancialAccount,
  scopePayment,
  scopeAccountOperation,
} from "@/lib/branch-scope"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Banknote, Building, CreditCard, Globe } from "lucide-react"
import { AddAccountDialog } from "./add-account-dialog"
import { AddOperationDialog } from "./add-operation-dialog"
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

const OP_TYPE_LABELS: Record<string, string> = {
  owner_withdrawal: "Выемка",
  encashment: "Инкассация",
  transfer: "Перевод",
}

export default async function CashPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const userRole = session.user.role
  const params = await searchParams
  const scope = await getBranchScope()

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null, isActive: true, ...scopeFinancialAccount(scope) },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  })

  // Parse month filter (default: current month)
  const now = new Date()
  const filterYear = Number(params.year) || now.getFullYear()
  const filterMonth = Number(params.month) || (now.getMonth() + 1)

  const monthStart = new Date(Date.UTC(filterYear, filterMonth - 1, 1))
  const monthEnd = new Date(Date.UTC(filterYear, filterMonth, 0, 23, 59, 59, 999))

  // Account-level totals for the month (used in account cards)
  const paymentSums = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
      ...scopePayment(scope),
    },
    select: { accountId: true, type: true, amount: true },
  })

  // Account operations for selected month
  const operations = await db.accountOperation.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
      ...scopeAccountOperation(scope),
    },
    include: {
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  })

  // Branches for dialog
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Calculate totals for the month per account
  const monthTotals: Record<string, { incoming: number; outgoing: number }> = {}
  for (const a of accounts) {
    monthTotals[a.id] = { incoming: 0, outgoing: 0 }
  }
  for (const p of paymentSums) {
    if (!monthTotals[p.accountId]) continue
    // transfer_in — виртуальное списание с баланса родителя в счёт абонемента
    // (или сторно скидки): деньги по кассам не двигаются, а accountId у таких
    // платежей — техническая заглушка (первый счёт организации). В поступления
    // месяца не включаем, как в ДДС, — иначе двойной счёт и приписывание суммы
    // чужой кассе (Баг #3).
    if (p.type === "transfer_in") continue
    if (p.type === "incoming") {
      monthTotals[p.accountId].incoming += Number(p.amount)
    } else {
      monthTotals[p.accountId].outgoing += Number(p.amount)
    }
  }

  const cashAccounts = accounts.filter((a) => a.type === "cash")
  const cashlessAccounts = accounts.filter((a) => a.type !== "cash")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Касса</h1>
          <PageHelp pageKey="finance/cash" />
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker />
          {accounts.length >= 1 && (
            <AddOperationDialog
              accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
            />
          )}
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
          <div className="grid gap-4 lg:grid-cols-2">
            <AccountColumn
              title="Нал"
              accounts={cashAccounts}
              monthTotals={monthTotals}
              branches={branches}
              userRole={userRole}
            />
            <AccountColumn
              title="Безнал"
              accounts={cashlessAccounts}
              monthTotals={monthTotals}
              branches={branches}
              userRole={userRole}
            />
          </div>

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

interface AccountRow {
  id: string
  name: string
  type: string
  branchId: string | null
  balance: import("@prisma/client").Prisma.Decimal
  branch: { id: string; name: string } | null
}

interface AccountColumnProps {
  title: string
  accounts: AccountRow[]
  monthTotals: Record<string, { incoming: number; outgoing: number }>
  branches: { id: string; name: string }[]
  userRole: string
}

function AccountColumn({ title, accounts, monthTotals, branches, userRole }: AccountColumnProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Нет счетов
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
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
                        account={{
                          id: a.id,
                          name: a.name,
                          type: a.type,
                          branchId: a.branchId,
                          balance,
                        }}
                        branches={branches}
                        userRole={userRole}
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
      )}
    </div>
  )
}
