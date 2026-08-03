import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeFinancialAccount } from "@/lib/branch-scope"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Banknote, Building, CreditCard, Globe, Wallet } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { DayPicker } from "@/components/day-picker"
import { formatMoney as fmtCurrency } from "@/lib/currency"
import { getOrgUiSettings } from "@/lib/role-names"

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

interface AccountAtDate {
  id: string
  name: string
  type: string
  branch: { id: string; name: string } | null
  balance: number
}

export default async function CashBalanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  const formatMoney = (amount: number) => fmtCurrency(amount, currency)

  // Разбор выбранной даты (?date=YYYY-MM-DD, по умолчанию — сегодня).
  const params = await searchParams
  const raw = typeof params.date === "string" ? params.date : ""
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  let year: number, month: number, day: number
  if (matched) {
    year = Number(matched[1]); month = Number(matched[2]); day = Number(matched[3])
  } else {
    const now = new Date()
    year = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate()
  }
  // «На конец дня X» = текущий баланс минус все движения, датированные ПОЗЖЕ X.
  // Даты движений хранятся как @db.Date (полночь UTC), поэтому граница —
  // начало следующего дня. Date.UTC корректно переносит день через край месяца.
  const cutoff = new Date(Date.UTC(year, month - 1, day + 1))
  const dateLabel = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`

  // Счета, существовавшие на выбранную дату (созданы до конца дня), видимые
  // пользователю (строгий скоуп филиалов — как на странице «Касса»).
  const accounts = await db.financialAccount.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      createdAt: { lt: cutoff },
      ...scopeFinancialAccount(scope),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  })

  const visibleIds = accounts.map((a) => a.id)

  // Движения ПОСЛЕ выбранной даты — чтобы «откатить» текущий баланс к концу дня X.
  // Учитываем только то, что реально двигает остаток счёта: приход (+), возврат (−),
  // расход/ЗП (−), перевод/инкассация/выемка (по счетам «откуда/куда»). Переносы
  // баланса между абонементами (transfer_in и парное «плечо»-возврат) кассу не
  // трогают — исключаем. Пустой visibleIds → Prisma `in: []` даёт пустые агрегаты.
  const [incAgg, refunds, expAgg, salAgg, operations] = await Promise.all([
    // Приходы (type=incoming) увеличивают остаток на сумму платежа.
    db.payment.groupBy({
      by: ["accountId"],
      where: {
        tenantId,
        deletedAt: null,
        type: "incoming",
        accountId: { in: visibleIds },
        date: { gte: cutoff },
      },
      _sum: { amount: true },
    }),
    // Возвраты уменьшают остаток. ЮKassa хранит возврат положительной суммой,
    // ручной — отрицательной, поэтому берём модуль. Виртуальные плечи «переноса
    // баланса между абонементами» (comment «Перенос на: …») кассу не двигают —
    // отсеиваем их в JS ниже.
    db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: "refund",
        accountId: { in: visibleIds },
        date: { gte: cutoff },
      },
      select: { accountId: true, amount: true, comment: true },
    }),
    db.expense.groupBy({
      by: ["accountId"],
      where: {
        tenantId,
        deletedAt: null,
        accountId: { in: visibleIds },
        date: { gte: cutoff },
      },
      _sum: { amount: true },
    }),
    db.salaryPayment.groupBy({
      by: ["accountId"],
      where: { tenantId, accountId: { in: visibleIds }, date: { gte: cutoff } },
      _sum: { amount: true },
    }),
    db.accountOperation.findMany({
      where: {
        tenantId,
        deletedAt: null,
        date: { gte: cutoff },
        OR: [{ fromAccountId: { in: visibleIds } }, { toAccountId: { in: visibleIds } }],
      },
      select: { fromAccountId: true, toAccountId: true, amount: true },
    }),
  ])

  // deltaAfter[acc] — суммарное изменение баланса счёта движениями после X.
  const deltaAfter: Record<string, number> = {}
  for (const id of visibleIds) deltaAfter[id] = 0
  for (const r of incAgg) {
    if (r.accountId && deltaAfter[r.accountId] !== undefined) deltaAfter[r.accountId] += Number(r._sum.amount || 0)
  }
  for (const p of refunds) {
    // Плечо «переноса баланса между абонементами» — не кассовое движение.
    if (p.comment && p.comment.startsWith("Перенос на:")) continue
    if (deltaAfter[p.accountId] !== undefined) deltaAfter[p.accountId] -= Math.abs(Number(p.amount))
  }
  for (const r of expAgg) {
    if (r.accountId && deltaAfter[r.accountId] !== undefined) deltaAfter[r.accountId] -= Number(r._sum.amount || 0)
  }
  for (const r of salAgg) {
    if (deltaAfter[r.accountId] !== undefined) deltaAfter[r.accountId] -= Number(r._sum.amount || 0)
  }
  for (const op of operations) {
    if (op.fromAccountId && deltaAfter[op.fromAccountId] !== undefined) deltaAfter[op.fromAccountId] -= Number(op.amount)
    if (op.toAccountId && deltaAfter[op.toAccountId] !== undefined) deltaAfter[op.toAccountId] += Number(op.amount)
  }

  const accountsAtDate: AccountAtDate[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    branch: a.branch,
    balance: Number(a.balance) - (deltaAfter[a.id] || 0),
  }))

  const cashAccounts = accountsAtDate.filter((a) => a.type === "cash")
  const cashlessAccounts = accountsAtDate.filter((a) => a.type !== "cash")
  const total = accountsAtDate.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Баланс касс</h1>
            <PageHelp pageKey="reports/finance/cash-balance" />
          </div>
          <p className="text-sm text-muted-foreground">
            Остатки по всем счетам на конец выбранного дня (23:59)
          </p>
        </div>
        <DayPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>На конец дня:</span>
        <Badge variant="outline">{dateLabel}</Badge>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            На выбранную дату счетов не существовало.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Итого по всем видимым счетам */}
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50">
                <Wallet className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Итого на счетах на {dateLabel}</p>
                <p className={`text-lg font-bold ${total >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatMoney(total)}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <AccountColumn title="Нал" accounts={cashAccounts} currency={currency} />
            <AccountColumn title="Безнал" accounts={cashlessAccounts} currency={currency} />
          </div>
        </>
      )}
    </div>
  )
}

function AccountColumn({
  title,
  accounts,
  currency,
}: {
  title: string
  accounts: AccountAtDate[]
  currency: string
}) {
  const formatMoney = (amount: number) => fmtCurrency(amount, currency)
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
            return (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className={`flex size-10 items-center justify-center rounded-lg ${typeInfo.bg}`}>
                      <Icon className={`size-5 ${typeInfo.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-muted-foreground">
                        {a.name}
                        {a.branch ? ` · ${a.branch.name}` : ""}
                      </p>
                      <p className={`text-lg font-bold ${a.balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatMoney(a.balance)}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{TYPE_LABELS[a.type]}</Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
