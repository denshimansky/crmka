import Link from "next/link"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import {
  scopeFinancialAccount,
  scopePayment,
  scopeExpense,
  scopeAccountOperation,
  scopeEmployee,
} from "@/lib/branch-scope"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowDownCircle, ArrowUpCircle, Wallet, ArrowRightLeft } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"

function formatMoney(amount: number): string {
  const sign = amount < 0 ? "−" : amount > 0 ? "+" : ""
  return sign + new Intl.NumberFormat("ru-RU").format(Math.abs(Math.round(amount * 100) / 100)) + " ₽"
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: "Касса",
  bank_account: "Р/С",
  acquiring: "Эквайринг",
  online: "Онлайн",
}

const OP_TYPE_LABELS: Record<string, string> = {
  owner_withdrawal: "Выемка",
  encashment: "Инкассация",
  transfer: "Перевод",
}

type JournalKind =
  | "income"
  | "refund"
  | "expense"
  | "salary"
  | "transfer"
  | "withdrawal"
  | "encashment"
  | "balance_out"
  | "subscription_in"

interface JournalRow {
  id: string
  kind: JournalKind
  date: Date
  amount: number // знаковая: + приход, − расход; для transfer — положительная (без знака)
  category: string
  counterparty: string
  account: string
  responsible: string
  comment: string
  href?: string // для перехода в исходник
}

const KIND_LABELS: Record<JournalKind, { label: string; classes: string }> = {
  income: { label: "Приход", classes: "bg-green-100 text-green-800" },
  refund: { label: "Возврат", classes: "bg-orange-100 text-orange-800" },
  expense: { label: "Расход", classes: "bg-red-100 text-red-800" },
  salary: { label: "ЗП", classes: "bg-purple-100 text-purple-800" },
  transfer: { label: "Перевод", classes: "bg-blue-100 text-blue-800" },
  withdrawal: { label: "Выемка", classes: "bg-amber-100 text-amber-800" },
  encashment: { label: "Инкассация", classes: "bg-cyan-100 text-cyan-800" },
  balance_out: { label: "С баланса", classes: "bg-violet-100 text-violet-800" },
  subscription_in: { label: "На абонемент", classes: "bg-emerald-100 text-emerald-800" },
}

export default async function DdsJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()

  const params = await searchParams
  const { year, month } = getMonthFromParams(params)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const accountFilter = typeof params.account === "string" ? params.account : undefined
  const kindFilter = typeof params.kind === "string" ? params.kind : undefined

  // === Счета (для шапки и для join'а имени счёта в строки) ===
  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null, ...scopeFinancialAccount(scope) },
    select: { id: true, name: true, type: true, balance: true, isActive: true },
    orderBy: { createdAt: "asc" },
  })
  const accountById = new Map(accounts.map(a => [a.id, a]))

  // === Сотрудники (для имени ответственного) ===
  const employees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, ...scopeEmployee(scope) },
    select: { id: true, firstName: true, lastName: true },
  })
  const employeeById = new Map(employees.map(e => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ").trim()]))

  function responsibleName(id: string | null | undefined): string {
    if (!id) return "—"
    return employeeById.get(id) || "—"
  }

  // === Загрузка операций периода ===
  const [payments, expenses, salaryPayments, operations] = await Promise.all([
    db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        date: { gte: monthStart, lte: monthEnd },
        ...scopePayment(scope),
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
        subscription: { select: { direction: { select: { name: true } } } },
        incomeCategory: { select: { name: true } },
      },
    }),
    db.expense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        date: { gte: monthStart, lte: monthEnd },
        ...scopeExpense(scope),
      },
      include: { category: { select: { name: true } } },
    }),
    db.salaryPayment.findMany({
      where: {
        tenantId,
        date: { gte: monthStart, lte: monthEnd },
        employee: scopeEmployee(scope),
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    }),
    db.accountOperation.findMany({
      where: {
        tenantId,
        deletedAt: null,
        date: { gte: monthStart, lte: monthEnd },
        ...scopeAccountOperation(scope),
      },
      include: {
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
      },
    }),
  ])

  // === Строки журнала ===
  const rows: JournalRow[] = []

  for (const p of payments) {
    const accName = accountById.get(p.accountId)?.name ?? "—"
    const counterparty = p.client
      ? [p.client.lastName, p.client.firstName].filter(Boolean).join(" ").trim() || "—"
      : "Прочий доход"

    // Списание с баланса родителя в счёт абонемента — НЕ движение денег
    // на счетах компании, а внутренняя проводка. Показываем в журнале парой
    // строк (−Баланс / +Абонемент), но в топ-карточки «Поступления»/
    // «Выбытия» не включаем (отдельные kind balance_out/subscription_in).
    if (p.type === "transfer_in") {
      const subLabel = p.subscription?.direction.name
        ? `: ${p.subscription.direction.name}`
        : ""
      rows.push({
        id: `payment:${p.id}:out`,
        kind: "balance_out",
        date: p.date,
        amount: -Number(p.amount),
        category: `Списание с баланса родителя`,
        counterparty,
        account: "—",
        responsible: responsibleName(p.createdBy),
        comment: p.comment ?? "",
        href: "/finance/payments",
      })
      rows.push({
        id: `payment:${p.id}:in`,
        kind: "subscription_in",
        date: p.date,
        amount: Number(p.amount),
        category: `Оплата абонемента${subLabel}`,
        counterparty,
        account: "—",
        responsible: responsibleName(p.createdBy),
        comment: p.comment ?? "",
        href: "/finance/payments",
      })
      continue
    }

    const category =
      p.type === "refund"
        ? "Возврат клиенту"
        : p.subscription?.direction.name
          ? `Оплата абонемента: ${p.subscription.direction.name}`
          : p.incomeCategory?.name ?? METHOD_LABELS[p.method] ?? "Поступление"
    const amount = p.type === "refund" ? -Number(p.amount) : Number(p.amount)
    rows.push({
      id: `payment:${p.id}`,
      kind: p.type === "refund" ? "refund" : "income",
      date: p.date,
      amount,
      category,
      counterparty,
      account: accName,
      responsible: responsibleName(p.createdBy),
      comment: p.comment ?? "",
      href: "/finance/payments",
    })
  }

  for (const e of expenses) {
    const accName = accountById.get(e.accountId)?.name ?? "—"
    rows.push({
      id: `expense:${e.id}`,
      kind: "expense",
      date: e.date,
      amount: -Number(e.amount),
      category: e.category.name,
      counterparty: "—",
      account: accName,
      responsible: responsibleName(e.createdBy),
      comment: e.comment ?? "",
      href: "/finance/expenses",
    })
  }

  for (const sp of salaryPayments) {
    const accName = accountById.get(sp.accountId)?.name ?? "—"
    const empName = [sp.employee.lastName, sp.employee.firstName].filter(Boolean).join(" ").trim() || "—"
    rows.push({
      id: `salary:${sp.id}`,
      kind: "salary",
      date: sp.date,
      amount: -Number(sp.amount),
      category: `Выплата ЗП за ${String(sp.periodMonth).padStart(2, "0")}.${sp.periodYear}`,
      counterparty: empName,
      account: accName,
      responsible: responsibleName(sp.createdBy),
      comment: sp.comment ?? "",
      href: "/salary",
    })
  }

  for (const op of operations) {
    const kind: JournalKind =
      op.type === "transfer" ? "transfer" : op.type === "owner_withdrawal" ? "withdrawal" : "encashment"
    const fromName = op.fromAccount?.name ?? "—"
    const toName = op.toAccount?.name ?? "—"
    const accountField =
      op.type === "transfer"
        ? `${fromName} → ${toName}`
        : op.type === "owner_withdrawal"
          ? fromName
          : `${fromName} → ${toName}`
    rows.push({
      id: `op:${op.id}`,
      kind,
      date: op.date,
      // Для withdrawal — это вывод собственника (минус). Для transfer/encashment — внутреннее перемещение (без знака).
      amount: op.type === "owner_withdrawal" ? -Number(op.amount) : Number(op.amount),
      category: OP_TYPE_LABELS[op.type] ?? op.type,
      counterparty: "—",
      account: accountField,
      responsible: responsibleName(op.createdBy),
      comment: op.description ?? "",
      href: "/finance/cash",
    })
  }

  // === Фильтры ===
  let filteredRows = rows

  if (accountFilter) {
    const filterName = accountById.get(accountFilter)?.name
    if (filterName) {
      filteredRows = filteredRows.filter(r => {
        // Для transfer/encashment — проверяем, что одна из сторон совпадает по имени.
        if (r.account.includes("→")) {
          const [from, to] = r.account.split("→").map(s => s.trim())
          return from === filterName || to === filterName
        }
        return r.account === filterName
      })
    }
  }

  if (kindFilter && kindFilter !== "all") {
    filteredRows = filteredRows.filter(r => r.kind === kindFilter)
  }

  filteredRows.sort((a, b) => a.date.getTime() - b.date.getTime())

  // === Сводки по карточкам счетов ===
  const monthSummary: Record<string, { incoming: number; outgoing: number }> = {}
  for (const a of accounts) monthSummary[a.id] = { incoming: 0, outgoing: 0 }
  for (const p of payments) {
    if (!monthSummary[p.accountId]) continue
    // transfer_in — внутреннее списание с баланса, счёт не двигается.
    if (p.type === "transfer_in") continue
    if (p.type === "refund") monthSummary[p.accountId].outgoing += Number(p.amount)
    else monthSummary[p.accountId].incoming += Number(p.amount)
  }
  for (const e of expenses) {
    if (!monthSummary[e.accountId]) continue
    monthSummary[e.accountId].outgoing += Number(e.amount)
  }
  for (const sp of salaryPayments) {
    if (!monthSummary[sp.accountId]) continue
    monthSummary[sp.accountId].outgoing += Number(sp.amount)
  }
  for (const op of operations) {
    if (op.type === "transfer" || op.type === "encashment") {
      if (op.fromAccountId && monthSummary[op.fromAccountId]) monthSummary[op.fromAccountId].outgoing += Number(op.amount)
      if (op.toAccountId && monthSummary[op.toAccountId]) monthSummary[op.toAccountId].incoming += Number(op.amount)
    } else if (op.type === "owner_withdrawal") {
      if (op.fromAccountId && monthSummary[op.fromAccountId]) monthSummary[op.fromAccountId].outgoing += Number(op.amount)
    }
  }

  // === Итоги периода для топ-карточек ===
  const totalIncome = rows.filter(r => r.kind === "income").reduce((s, r) => s + r.amount, 0)
  const totalOutflow = rows
    .filter(r => r.kind === "expense" || r.kind === "salary" || r.kind === "refund" || r.kind === "withdrawal")
    .reduce((s, r) => s + Math.abs(r.amount), 0)
  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0)

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // === Данные для экспорта (по одной строке журнала) ===
  const exportRows = filteredRows.map(r => ({
    date: formatDate(r.date),
    kind: KIND_LABELS[r.kind].label,
    category: r.category,
    counterparty: r.counterparty,
    account: r.account,
    amount: Math.round(r.amount * 100) / 100,
    responsible: r.responsible,
    comment: r.comment,
  }))

  // Helper: ссылки фильтра с сохранением месяца.
  function filterHref(patch: Record<string, string | undefined>): string {
    const sp = new URLSearchParams()
    sp.set("year", String(year))
    sp.set("month", String(month))
    const merged = { account: accountFilter, kind: kindFilter, ...patch }
    if (merged.account) sp.set("account", merged.account)
    if (merged.kind && merged.kind !== "all") sp.set("kind", merged.kind)
    return `?${sp.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">ДДС</h1>
            <PageHelp pageKey="finance/dds" />
          </div>
          <p className="text-sm text-muted-foreground">Журнал движения денег: построчно, день в день</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker />
          <ReportExport
            title="Журнал ДДС"
            filename={`dds-journal-${monthKey}`}
            columns={[
              { header: "Дата", key: "date", width: 12 },
              { header: "Тип", key: "kind", width: 12 },
              { header: "Категория", key: "category", width: 30 },
              { header: "Контрагент", key: "counterparty", width: 22 },
              { header: "Счёт", key: "account", width: 22 },
              { header: "Сумма", key: "amount", width: 14 },
              { header: "Ответственный", key: "responsible", width: 20 },
              { header: "Комментарий", key: "comment", width: 30 },
            ]}
            rows={exportRows}
            period={monthName}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      {/* Топ-карточки */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-50">
              <ArrowDownCircle className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Поступления</p>
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
              <p className="text-xs text-muted-foreground">Выбытия</p>
              <p className="text-lg font-bold text-red-600">{formatMoney(-totalOutflow)}</p>
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
              <p className="text-lg font-bold">{new Intl.NumberFormat("ru-RU").format(Math.round(totalBalance))} ₽</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Карточки счетов */}
      {accounts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accounts.map(a => {
            const summary = monthSummary[a.id] ?? { incoming: 0, outgoing: 0 }
            const typeLabel = ACCOUNT_TYPE_LABELS[a.type] ?? a.type
            const isFilterActive = accountFilter === a.id
            return (
              <Link key={a.id} href={filterHref({ account: isFilterActive ? undefined : a.id })}>
                <Card className={`hover:border-primary/50 transition-colors ${isFilterActive ? "border-primary" : ""}`}>
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{typeLabel}</span>
                      {isFilterActive && <Badge variant="outline" className="text-[10px]">фильтр</Badge>}
                    </div>
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-lg font-bold">
                      {new Intl.NumberFormat("ru-RU").format(Math.round(Number(a.balance)))} ₽
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-600">
                        +{new Intl.NumberFormat("ru-RU").format(Math.round(summary.incoming))}
                      </span>
                      <span className="text-red-600">
                        −{new Intl.NumberFormat("ru-RU").format(Math.round(summary.outgoing))}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {/* Кинд-фильтры */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">Фильтр:</span>
        <Link href={filterHref({ kind: undefined })}>
          <Badge variant={!kindFilter || kindFilter === "all" ? "default" : "outline"}>Все ({rows.length})</Badge>
        </Link>
        {(["income", "expense", "salary", "transfer", "refund", "withdrawal", "encashment"] as JournalKind[]).map(k => {
          const count = rows.filter(r => r.kind === k).length
          if (count === 0) return null
          return (
            <Link key={k} href={filterHref({ kind: kindFilter === k ? undefined : k })}>
              <Badge variant={kindFilter === k ? "default" : "outline"}>
                {KIND_LABELS[k].label} ({count})
              </Badge>
            </Link>
          )
        })}
        {(accountFilter || (kindFilter && kindFilter !== "all")) && (
          <Link href={filterHref({ account: undefined, kind: undefined })}>
            <Badge variant="secondary">Сбросить фильтры</Badge>
          </Link>
        )}
      </div>

      {/* Журнал */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Журнал движений
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({filteredRows.length} {filteredRows.length === 1 ? "строка" : "строк"})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
              <ArrowRightLeft className="size-8" />
              <p className="text-sm">Нет движений за выбранный период{accountFilter || kindFilter ? " (с учётом фильтров)" : ""}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>Контрагент</TableHead>
                    <TableHead>Счёт</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Ответственный</TableHead>
                    <TableHead>Комментарий</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${KIND_LABELS[r.kind].classes}`}>
                          {KIND_LABELS[r.kind].label}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{r.category}</TableCell>
                      <TableCell className="text-muted-foreground">{r.counterparty}</TableCell>
                      <TableCell className="text-muted-foreground">{r.account}</TableCell>
                      <TableCell className={`text-right font-medium ${r.amount > 0 ? "text-green-600" : r.amount < 0 ? "text-red-600" : ""}`}>
                        {formatMoney(r.amount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.responsible}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground" title={r.comment}>
                        {r.comment || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
