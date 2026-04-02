import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingDown, Repeat, BarChart3 } from "lucide-react"
import { AddExpenseDialog } from "./add-expense-dialog"
import { CopyMonthButton } from "./copy-month-button"
import { ExpensesTable } from "./expenses-table"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const expenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      account: { select: { id: true, name: true } },
      branches: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
    orderBy: { date: "desc" },
    take: 500,
  })

  // Суммы
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const variableExpenses = expenses.filter(e => e.isVariable).reduce((sum, e) => sum + Number(e.amount), 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const recurringCount = expenses.filter(e => e.isRecurring).length

  const summary = [
    { title: "Расходы за месяц", value: formatMoney(totalExpenses), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { title: "Постоянные", value: formatMoney(fixedExpenses), icon: BarChart3, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "Переменные", value: formatMoney(variableExpenses), icon: BarChart3, color: "text-yellow-600", bg: "bg-yellow-50" },
    { title: "Повторяющиеся", value: String(recurringCount), icon: Repeat, color: "text-blue-600", bg: "bg-blue-50" },
  ]

  // Данные для диалогов
  const categories = await db.expenseCategory.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
    select: { id: true, name: true, isVariable: true },
    orderBy: { sortOrder: "asc" },
  })

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  const allBranches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Подготовка данных для таблицы
  const tableExpenses = expenses.map(e => ({
    id: e.id,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    accountId: e.accountId,
    accountName: e.account.name,
    amount: Number(e.amount),
    date: e.date.toISOString().slice(0, 10),
    comment: e.comment,
    isRecurring: e.isRecurring,
    isVariable: e.isVariable,
    amortizationMonths: e.amortizationMonths,
    branchNames: e.branches.map(b => b.branch?.name).filter(Boolean) as string[],
    branchIds: e.branches.map(b => b.branchId).filter(Boolean) as string[],
  }))

  // Итоги по статьям
  const categoryTotals = new Map<string, number>()
  for (const e of expenses) {
    const prev = categoryTotals.get(e.category.name) || 0
    categoryTotals.set(e.category.name, prev + Number(e.amount))
  }
  const sortedCategoryTotals = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Расходы</h1>
          <MonthPicker />
        </div>
        <div className="flex items-center gap-2">
          <CopyMonthButton currentYear={year} currentMonth={month} />
          <AddExpenseDialog categories={categories} accounts={accounts} branches={allBranches} />
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

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <p>Нет расходов за текущий месяц</p>
            <p className="text-xs">Внесите первый расход или скопируйте с прошлого месяца</p>
          </CardContent>
        </Card>
      ) : (
        <ExpensesTable
          expenses={tableExpenses}
          categories={categories}
          accounts={accounts}
          branches={allBranches}
        />
      )}
    </div>
  )
}
