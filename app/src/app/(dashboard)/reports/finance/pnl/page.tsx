import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign } from "lucide-react"
import Link from "next/link"

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
    select: { chargeAmount: true },
  })
  const revenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // === РАСХОДЫ ===
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    include: { category: { select: { name: true, isSalary: true, isVariable: true } } },
  })

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  // Расходы по категориям
  const expenseByCategory = new Map<string, { amount: number; isSalary: boolean; isVariable: boolean }>()
  for (const e of expenses) {
    const key = e.category.name
    const prev = expenseByCategory.get(key) || { amount: 0, isSalary: e.category.isSalary, isVariable: e.category.isVariable }
    prev.amount += Number(e.amount)
    expenseByCategory.set(key, prev)
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
  const variableExpenses = expenses.filter(e => e.category.isVariable).reduce((s, e) => s + Number(e.amount), 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const totalVariableCosts = variableExpenses + totalSalaryAccrued
  const margin = revenue - totalVariableCosts
  const netProfit = revenue - totalExpenses - totalSalaryAccrued
  const profitability = revenue > 0 ? (netProfit / revenue) * 100 : 0

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Строки P&L
  const pnlRows = [
    { label: "Выручка (отработанные занятия)", amount: revenue, bold: true, color: "text-green-700" },
    { label: "", amount: 0, bold: false, color: "" }, // separator
    { label: "Переменные расходы:", amount: totalVariableCosts, bold: true, color: "text-red-700" },
    { label: "  ЗП инструкторов (начислено)", amount: totalSalaryAccrued, bold: false, color: "text-red-600" },
    ...Array.from(expenseByCategory.entries())
      .filter(([, v]) => v.isVariable)
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => ({ label: `  ${name}`, amount: v.amount, bold: false, color: "text-red-600" })),
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Маржа (Выручка − Переменные)", amount: margin, bold: true, color: margin >= 0 ? "text-green-700" : "text-red-700" },
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Постоянные расходы:", amount: fixedExpenses, bold: true, color: "text-orange-700" },
    ...Array.from(expenseByCategory.entries())
      .filter(([, v]) => !v.isVariable)
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => ({ label: `  ${name}`, amount: v.amount, bold: false, color: "text-orange-600" })),
    { label: "", amount: 0, bold: false, color: "" },
    { label: "Чистая прибыль", amount: netProfit, bold: true, color: netProfit >= 0 ? "text-green-700" : "text-red-700" },
    { label: "Рентабельность", amount: profitability, bold: true, color: profitability >= 0 ? "text-green-700" : "text-red-700" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Финансовый результат (P&L)</h1>
          <p className="text-sm text-muted-foreground">Выручка − Расходы − ЗП = Прибыль</p>
        </div>
        <MonthPicker />
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
                    <TableCell className={`text-right ${row.color}`}>{formatMoney(row.amount)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
