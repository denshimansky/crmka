import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeExpense, scopeBranch, scopeBookableAccount, scopeEmployee, isUnscoped } from "@/lib/branch-scope"
import { allocateSalaryPaymentsByBranch } from "@/lib/salary/allocate-payment-branches"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingDown, Wallet, BarChart3 } from "lucide-react"
import { AddExpenseDialog } from "./add-expense-dialog"
// CopyMonthButton временно скрыт — флаг «Повторяющийся» в формах тоже спрятан,
// без него кнопка ничего не находит. Возвращаем оба элемента одновременно.
// import { CopyMonthButton } from "./copy-month-button"
import { PageHelp } from "@/components/page-help"
import { ExpensesTable } from "./expenses-table"
import { formatMoney as fmtCurrency } from "@/lib/currency"
import { getOrgUiSettings } from "@/lib/role-names"
import { OKLAD_EXPENSE_CATEGORY_NAME } from "@/lib/salary/oklad-category"

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  const formatMoney = (amount: number) => fmtCurrency(amount, currency)

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // «По факту ДДС»: показываем только реальные движения денег со счёта
  // (accountId != null — исключает оклад-твины и списания склада, они денег не двигают)
  // и без пометки «не учитывать в финрезе» (recognitionMode=not_in_pnl). Зарплата на
  // странице — ТОЛЬКО фактические выплаты через модуль (запрос salaryPayments ниже),
  // поэтому ручные расходы в зарплатных категориях (category.isSalary) исключаем —
  // иначе задвоение с выплатами модуля.
  const expenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
      accountId: { not: null },
      recognitionMode: { not: "not_in_pnl" },
      category: { isSalary: false },
      ...scopeExpense(scope),
    },
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      account: { select: { id: true, name: true } },
      leadChannel: { select: { id: true, name: true } },
      branches: {
        include: {
          branch: { select: { id: true, name: true } },
          direction: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
    take: 500,
  })

  // Фактические выплаты ЗП за месяц (по дате выплаты) — как расходная строка в ДДС.
  const salaryPayments = await db.salaryPayment.findMany({
    where: {
      tenantId,
      date: { gte: monthStart, lte: monthEnd },
      employee: scopeEmployee(scope),
    },
    include: {
      employee: { select: { firstName: true, lastName: true } },
      account: { select: { name: true } },
    },
    orderBy: { date: "desc" },
    take: 500,
  })

  // Раскладка каждой выплаты по филиалам «как в финрезе» (оклад-твин ∝ выручке +
  // сделка по реальному филиалу занятий). Скоуп-админ видит только доли своих филиалов
  // (общесетевую/чужую долю режем — как для общих счетов/расходов).
  const salaryBranchAlloc = await allocateSalaryPaymentsByBranch(
    tenantId,
    salaryPayments.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      amount: Number(p.amount),
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
    })),
  )
  const partInScope = (branchId: string | null): boolean =>
    isUnscoped(scope) ? true : branchId !== null && scope.branchIds.includes(branchId)
  const salaryPartsById = new Map<string, { branchId: string | null; amount: number }[]>()
  for (const p of salaryPayments) {
    const parts = (salaryBranchAlloc.get(p.id) ?? [{ branchId: null, amount: Number(p.amount) }]).filter((pt) =>
      partInScope(pt.branchId),
    )
    salaryPartsById.set(p.id, parts)
  }
  const totalSalaryPayments = salaryPayments.reduce(
    (sum, p) => sum + (salaryPartsById.get(p.id) ?? []).reduce((s, pt) => s + pt.amount, 0),
    0,
  )

  // Суммы. «Расходы за месяц» = расходы со счёта + фактические выплаты ЗП (по факту ДДС),
  // поэтому Total = Постоянные + Переменные + Зарплата.
  const expensesTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const variableExpenses = expenses.filter(e => e.isVariable).reduce((sum, e) => sum + Number(e.amount), 0)
  const fixedExpenses = expensesTotal - variableExpenses
  const grandTotal = expensesTotal + totalSalaryPayments

  const summary = [
    { title: "Расходы за месяц", value: formatMoney(grandTotal), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { title: "Постоянные", value: formatMoney(fixedExpenses), icon: BarChart3, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "Переменные", value: formatMoney(variableExpenses), icon: BarChart3, color: "text-yellow-600", bg: "bg-yellow-50" },
    { title: "Зарплата (выплаты)", value: formatMoney(totalSalaryPayments), icon: Wallet, color: "text-blue-600", bg: "bg-blue-50" },
  ]

  // Данные для диалогов. Системную «Зарплата окладников» скрываем из ручного ввода:
  // это категория-твин (заполняется автоматически при выплате оклада), ручной расход
  // в неё задвоил бы оклад в ОПИУ.
  const categories = await db.expenseCategory.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
      NOT: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
    },
    select: { id: true, name: true, isVariable: true },
    orderBy: { sortOrder: "asc" },
  })

  // Селектор счёта для формы расхода — «на что можно провести»: общий счёт
  // остаётся выбираемым (баланс на «Кассе» при этом скрыт, см. scopeFinancialAccount).
  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null, ...scopeBookableAccount(scope) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  const allBranches = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  // Направления + филиалы, где у направления есть группы (для фильтрации в модалке).
  const directionsRaw = await db.direction.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      groups: { select: { branchId: true }, where: { deletedAt: null } },
    },
    orderBy: { sortOrder: "asc" },
  })
  const directions = directionsRaw.map((d) => ({
    id: d.id,
    name: d.name,
    branchIds: Array.from(new Set(d.groups.map((g) => g.branchId))),
  }))

  const leadChannels = await db.leadChannel.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: "asc" },
  })

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Подготовка данных для таблицы
  const tableExpenses = expenses.map(e => {
    // Направление берём из первой ExpenseBranch-строки (для всех строк одного
    // расхода direction одинаков — выставляем единое значение при сохранении).
    const firstDir = e.branches.find((b) => b.direction)?.direction
    return {
      id: e.id,
      categoryId: e.categoryId,
      categoryName: e.category.name,
      accountId: e.accountId ?? "",
      accountName: e.account?.name ?? "Без счёта (списание)",
      amount: Number(e.amount),
      date: e.date.toISOString().slice(0, 10),
      comment: e.comment,
      isRecurring: e.isRecurring,
      isVariable: e.isVariable,
      recognitionMode: e.recognitionMode,
      amortizationMonths: e.amortizationMonths,
      amortizationStartDate: e.amortizationStartDate ? e.amortizationStartDate.toISOString().slice(0, 10) : null,
      branchNames: e.branches.map(b => b.branch?.name).filter(Boolean) as string[],
      branchIds: e.branches.map(b => b.branchId).filter(Boolean) as string[],
      directionId: firstDir?.id ?? null,
      directionName: firstDir?.name ?? null,
      leadChannelId: e.leadChannelId,
      leadChannelName: e.leadChannel?.name ?? null,
    }
  })

  // Строки фактических выплат ЗП для таблицы (read-only, редактируются в «Зарплата»).
  // Раскладка по филиалам «как в финрезе»: выплата с несколькими филиалами разворачивается
  // в несколько строк (сумма дробится ∝ оклад-твину + сделке); Σ строк = сумма выплаты.
  const branchNameById = new Map(allBranches.map((b) => [b.id, b.name]))
  const salaryRows = salaryPayments.flatMap((p) => {
    const parts = salaryPartsById.get(p.id) ?? []
    const employeeName = [p.employee.lastName, p.employee.firstName].filter(Boolean).join(" ").trim() || "—"
    const accountName = p.account?.name ?? "—"
    const date = p.date.toISOString().slice(0, 10)
    const periodLabel = `за ${String(p.periodMonth).padStart(2, "0")}.${p.periodYear}`
    return parts.map((pt, idx) => ({
      id: parts.length > 1 ? `${p.id}:${idx}` : p.id,
      date,
      employeeName,
      accountName,
      amount: pt.amount,
      periodLabel,
      branchName: pt.branchId ? branchNameById.get(pt.branchId) ?? "—" : "Без филиала",
    }))
  })

  // Итоги по статьям (+ отдельной строкой выплаты ЗП).
  const categoryTotals = new Map<string, number>()
  for (const e of expenses) {
    const prev = categoryTotals.get(e.category.name) || 0
    categoryTotals.set(e.category.name, prev + Number(e.amount))
  }
  if (totalSalaryPayments > 0) categoryTotals.set("Зарплата (выплаты)", totalSalaryPayments)
  const sortedCategoryTotals = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 gap-y-2">
          <h1 className="text-2xl font-bold">Расходы</h1>
          <PageHelp pageKey="finance/expenses" />
          <MonthPicker />
        </div>
        <div className="flex items-center gap-2">
          {/* <CopyMonthButton currentYear={year} currentMonth={month} /> — скрыта вместе с чекбоксом «Повторяющийся» */}
          <AddExpenseDialog
            categories={categories}
            accounts={accounts}
            branches={allBranches}
            directions={directions}
            leadChannels={leadChannels}
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
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {sortedCategoryTotals.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Итого по статьям</p>
            <div className="flex flex-wrap gap-3">
              {sortedCategoryTotals.map(([name, total]) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{name}:</span>
                  <span className="font-medium">{formatMoney(total)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {expenses.length === 0 && salaryRows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <p>Нет расходов за текущий месяц</p>
            <p className="text-xs">Внесите первый расход или скопируйте с прошлого месяца</p>
          </CardContent>
        </Card>
      ) : (
        <ExpensesTable
          expenses={tableExpenses}
          salaryPayments={salaryRows}
          categories={categories}
          accounts={accounts}
          branches={allBranches}
          directions={directions}
          leadChannels={leadChannels}
        />
      )}
    </div>
  )
}
