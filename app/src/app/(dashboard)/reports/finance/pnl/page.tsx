import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, SplitSquareVertical } from "lucide-react"
import Link from "next/link"
import { DrilldownAmount } from "@/components/drilldown-amount"
import { ReportExport } from "@/components/report-export"
import { distributeFixedExpenses, type FixedExpenseItem } from "@/lib/expense-distribution"
import {
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export default async function PnlReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // === ВЫРУЧКА: списания с абонементов (chargedAmount) ===
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      attendanceType: { countsAsRevenue: true },
    },
    select: {
      chargeAmount: true,
      lesson: {
        select: {
          group: {
            select: {
              directionId: true,
              direction: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  const revenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Выручка по направлениям (для распределения постоянных расходов)
  const revenueByDirection: Record<string, { name: string; revenue: number }> = {}
  for (const a of attendances) {
    const dirId = a.lesson.group.directionId
    const dirName = a.lesson.group.direction.name
    if (!revenueByDirection[dirId]) {
      revenueByDirection[dirId] = { name: dirName, revenue: 0 }
    }
    revenueByDirection[dirId].revenue += Number(a.chargeAmount)
  }

  // === РАСХОДЫ ===
  // Расширяем окно: расходы с recognitionMode = single_period / amortized могли быть
  // оплачены сильно раньше отчётного месяца, но раскладка попадает в текущий месяц ОПИУ.
  const expensesFrom = new Date(monthStart)
  expensesFrom.setUTCMonth(expensesFrom.getUTCMonth() - AMORTIZATION_LOOKBACK_MONTHS)
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: expensesFrom, lte: monthEnd } },
    include: { category: { select: { id: true, name: true, isSalary: true, isVariable: true } } },
  })

  // Для каждого расхода — сумма, попавшая в текущий месяц с учётом раскладки.
  const expenseSlices = expenses
    .map((e) => ({
      categoryId: e.category.id,
      categoryName: e.category.name,
      isSalary: e.category.isSalary,
      isVariable: e.category.isVariable,
      amount: expenseAmountInWindow(e, year, month, year, month),
    }))
    .filter((s) => s.amount > 0)

  const totalExpenses = expenseSlices.reduce((s, x) => s + x.amount, 0)

  // Расходы по категориям
  const expenseByCategory = new Map<string, { amount: number; isSalary: boolean; isVariable: boolean }>()
  for (const s of expenseSlices) {
    const prev = expenseByCategory.get(s.categoryName) || { amount: 0, isSalary: s.isSalary, isVariable: s.isVariable }
    prev.amount += s.amount
    expenseByCategory.set(s.categoryName, prev)
  }

  // === ЗП (начислено из посещений) ===
  const salaryAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      instructorPayEnabled: true,
    },
    select: { instructorPayAmount: true },
  })
  const totalSalaryAccrued = salaryAttendances.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // === РАСЧЁТЫ ===
  const variableExpenses = expenseSlices.filter(s => s.isVariable).reduce((sum, s) => sum + s.amount, 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const totalVariableCosts = variableExpenses + totalSalaryAccrued
  const margin = revenue - totalVariableCosts
  const netProfit = revenue - totalExpenses - totalSalaryAccrued
  const profitability = revenue > 0 ? (netProfit / revenue) * 100 : 0

  // === FIN-16: Распределение постоянных расходов по направлениям ===
  const fixedExpenseItems: FixedExpenseItem[] = expenseSlices
    .filter(s => !s.isVariable)
    .reduce<FixedExpenseItem[]>((acc, s) => {
      const existing = acc.find(x => x.id === s.categoryId)
      if (existing) {
        existing.amount += s.amount
      } else {
        acc.push({ id: s.categoryId, category: s.categoryName, amount: s.amount })
      }
      return acc
    }, [])

  const revenueMap: Record<string, number> = {}
  for (const [dirId, info] of Object.entries(revenueByDirection)) {
    revenueMap[dirId] = info.revenue
  }
  const distribution = distributeFixedExpenses(fixedExpenseItems, revenueMap)

  const directionEntries = Object.entries(revenueByDirection)
    .map(([dirId, info]) => ({
      directionId: dirId,
      name: info.name,
      revenue: info.revenue,
      revenueShare: revenue > 0 ? Math.round((info.revenue / revenue) * 1000) / 10 : 0,
      distributedFixed: distribution.totalByKey[dirId] ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // Строки P&L
  const pnlRows: { label: string; amount: number; bold: boolean; color: string; drillField?: string }[] = [
    { label: "Выручка (отработанные занятия)", amount: revenue, bold: true, color: "text-green-700", drillField: "revenue" },
    { label: "", amount: 0, bold: false, color: "" }, // separator
    { label: "Переменные расходы:", amount: totalVariableCosts, bold: true, color: "text-red-700" },
    { label: "  ЗП инструкторов (начислено)", amount: totalSalaryAccrued, bold: false, color: "text-red-600", drillField: "salary" },
    ...Array.from(expenseByCategory.entries())
      .filter(([, v]) => v.isVariable)
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => ({ label: `  ${name}`, amount: v.amount, bold: false, color: "text-red-600" })),
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Маржа (Выручка − Переменные)", amount: margin, bold: true, color: margin >= 0 ? "text-green-700" : "text-red-700" },
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Постоянные расходы:", amount: fixedExpenses, bold: true, color: "text-orange-700", drillField: "expenses" },
    ...Array.from(expenseByCategory.entries())
      .filter(([, v]) => !v.isVariable)
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => ({ label: `  ${name}`, amount: v.amount, bold: false, color: "text-orange-600" })),
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Чистая прибыль", amount: netProfit, bold: true, color: netProfit >= 0 ? "text-green-700" : "text-red-700" },
    { label: "Рентабельность", amount: profitability, bold: true, color: profitability >= 0 ? "text-green-700" : "text-red-700" },
  ]

  // Данные для экспорта
  const exportRows = pnlRows
    .filter((r) => r.label !== "")
    .map((r) => ({
      label: r.label,
      amount: r.label === "Рентабельность" ? `${r.amount.toFixed(1)}%` : Math.round(r.amount),
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Финансовый результат (P&L)</h1>
            <PageHelp pageKey="reports/finance/pnl" />
          </div>
          <p className="text-sm text-muted-foreground">Выручка − Расходы − ЗП = Прибыль</p>
        </div>
        <MonthPicker />
        <ReportExport
          title="Финансовый результат (P&L)"
          filename={`pnl-${monthKey}`}
          columns={[
            { header: "Показатель", key: "label", width: 40 },
            { header: "Сумма", key: "amount", width: 18 },
          ]}
          rows={exportRows}
          period={monthName}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Выручка</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(revenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Маржа</p>
            <p className={`text-2xl font-bold ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatMoney(margin)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Чистая прибыль</p>
            <p className={`text-2xl font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatMoney(netProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Рентабельность</p>
            <p className={`text-2xl font-bold ${profitability >= 0 ? "text-green-600" : "text-red-600"}`}>
              {profitability.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Отчёт P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {pnlRows.map((row, i) => {
                if (row.label === "") return <TableRow key={i}><TableCell colSpan={2} className="h-2 p-0" /></TableRow>
                if (row.label === "Рентабельность") {
                  return (
                    <TableRow key={i} className={row.bold ? "font-bold" : ""}>
                      <TableCell className={row.color}>{row.label}</TableCell>
                      <TableCell className={`text-right ${row.color}`}>{row.amount.toFixed(1)}%</TableCell>
                    </TableRow>
                  )
                }
                return (
                  <TableRow key={i} className={row.bold ? "font-bold" : ""}>
                    <TableCell className={row.color}>{row.label}</TableCell>
                    <TableCell className={`text-right ${row.color}`}>
                      {row.drillField ? (
                        <DrilldownAmount
                          amount={formatMoney(row.amount)}
                          report="pnl"
                          field={row.drillField}
                          month={monthKey}
                          title={`Детализация: ${row.label.trim()}`}
                          className={row.color}
                        />
                      ) : (
                        formatMoney(row.amount)
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* FIN-16: Распределение постоянных расходов по направлениям */}
      {directionEntries.length > 0 && fixedExpenses > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <SplitSquareVertical className="size-4 text-orange-600" />
              <CardTitle className="text-base">Распределение постоянных расходов по направлениям</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="outline" className="text-xs">авто</Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Постоянные расходы распределяются пропорционально доле выручки каждого направления</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Формула: доля направления = выручка направления / общая выручка
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                  <TableHead className="text-right">Пост. расходы (распред.)</TableHead>
                  <TableHead className="text-right">P&L направления</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directionEntries.map((dir) => {
                  const dirNetProfit = dir.revenue - dir.distributedFixed
                  return (
                    <TableRow key={dir.directionId}>
                      <TableCell className="font-medium">{dir.name}</TableCell>
                      <TableCell className="text-right text-green-700">{formatMoney(dir.revenue)}</TableCell>
                      <TableCell className="text-right">{dir.revenueShare}%</TableCell>
                      <TableCell className="text-right text-orange-600">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                              {formatMoney(dir.distributedFixed)}
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-1 text-xs">
                                {(distribution.byKey[dir.directionId] ?? []).map((item, idx) => (
                                  <div key={idx} className="flex justify-between gap-4">
                                    <span>{item.category}</span>
                                    <span>{formatMoney(item.distributedAmount)}</span>
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className={`text-right font-medium ${dirNetProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {formatMoney(dirNetProfit)}
                      </TableCell>
                    </TableRow>
                  )
                })}
                <TableRow className="font-bold border-t-2">
                  <TableCell>Итого</TableCell>
                  <TableCell className="text-right text-green-700">{formatMoney(revenue)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                  <TableCell className="text-right text-orange-600">{formatMoney(fixedExpenses)}</TableCell>
                  <TableCell className={`text-right ${revenue - fixedExpenses >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {formatMoney(revenue - fixedExpenses)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
