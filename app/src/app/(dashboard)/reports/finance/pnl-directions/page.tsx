import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { ReportExport } from "@/components/report-export"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " \u20BD"
}

export default async function PnlDirectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const sp = await searchParams

  const { year, month } = getMonthFromParams(sp)
  const branchId = typeof sp.branchId === "string" ? sp.branchId : undefined

  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Branches for filter
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // === Revenue by direction (attended lessons) ===
  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: monthStart, lte: monthEnd } },
    attendanceType: { countsAsRevenue: true },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      chargeAmount: true,
      instructorPayAmount: true,
      instructorPayEnabled: true,
      lesson: {
        select: {
          group: {
            select: {
              direction: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })

  const dirMap = new Map<
    string,
    { name: string; revenue: number; salary: number }
  >()

  for (const a of attendances) {
    const dirId = a.lesson.group.direction.id
    const dirName = a.lesson.group.direction.name
    const prev = dirMap.get(dirId) || { name: dirName, revenue: 0, salary: 0 }
    prev.revenue += Number(a.chargeAmount)
    if (a.instructorPayEnabled) {
      prev.salary += Number(a.instructorPayAmount)
    }
    dirMap.set(dirId, prev)
  }

  const totalRevenue = Array.from(dirMap.values()).reduce(
    (s, d) => s + d.revenue,
    0
  )

  // === Expenses ===
  const expWhere: any = {
    tenantId,
    deletedAt: null,
    date: { gte: monthStart, lte: monthEnd },
  }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    include: {
      category: { select: { name: true, isSalary: true, isVariable: true } },
      branches: { select: { directionId: true } },
    },
  })

  let totalFixed = 0
  const directExpensesByDir = new Map<string, number>()

  for (const e of expenses) {
    const amount = Number(e.amount)
    const isVariable = e.category.isVariable
    const linkedDirIds = e.branches
      .map((b) => b.directionId)
      .filter(Boolean) as string[]

    if (isVariable && linkedDirIds.length > 0) {
      const perDir = amount / linkedDirIds.length
      for (const dirId of linkedDirIds) {
        directExpensesByDir.set(
          dirId,
          (directExpensesByDir.get(dirId) || 0) + perDir
        )
      }
    } else {
      totalFixed += amount
    }
  }

  // === Build rows ===
  const allDirIds = new Set([...dirMap.keys(), ...directExpensesByDir.keys()])

  interface DirRow {
    name: string
    revenue: number
    salary: number
    directExpenses: number
    variableCosts: number
    fixedDistributed: number
    margin: number
    netProfit: number
    profitability: number
    revenueShare: number
  }

  const rows: DirRow[] = Array.from(allDirIds)
    .map((dirId) => {
      const d = dirMap.get(dirId) || { name: "Без направления", revenue: 0, salary: 0 }
      const revenue = d.revenue
      const salary = d.salary
      const directExpenses = directExpensesByDir.get(dirId) || 0
      const variableCosts = salary + directExpenses
      const revenueShare = totalRevenue > 0 ? revenue / totalRevenue : 0
      const fixedDistributed = totalFixed * revenueShare
      const margin = revenue - variableCosts
      const netProfit = revenue - variableCosts - fixedDistributed

      return {
        name: d.name,
        revenue,
        salary,
        directExpenses,
        variableCosts,
        fixedDistributed: Math.round(fixedDistributed * 100) / 100,
        margin,
        netProfit: Math.round(netProfit * 100) / 100,
        profitability: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
        revenueShare: Math.round(revenueShare * 1000) / 10,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  // Totals
  const totals = {
    revenue: totalRevenue,
    salary: rows.reduce((s, r) => s + r.salary, 0),
    directExpenses: rows.reduce((s, r) => s + r.directExpenses, 0),
    variableCosts: rows.reduce((s, r) => s + r.variableCosts, 0),
    fixedDistributed: totalFixed,
    margin: rows.reduce((s, r) => s + r.margin, 0),
    netProfit: rows.reduce((s, r) => s + r.netProfit, 0),
    profitability: totalRevenue > 0
      ? Math.round((rows.reduce((s, r) => s + r.netProfit, 0) / totalRevenue) * 1000) / 10
      : 0,
  }

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // Export data
  const exportRows = [
    ...rows.map((r) => ({
      direction: r.name,
      revenue: Math.round(r.revenue),
      salary: Math.round(r.salary),
      directExpenses: Math.round(r.directExpenses),
      fixedDistributed: Math.round(r.fixedDistributed),
      margin: Math.round(r.margin),
      netProfit: Math.round(r.netProfit),
      profitability: `${r.profitability}%`,
    })),
    {
      direction: "Итого",
      revenue: Math.round(totals.revenue),
      salary: Math.round(totals.salary),
      directExpenses: Math.round(totals.directExpenses),
      fixedDistributed: Math.round(totals.fixedDistributed),
      margin: Math.round(totals.margin),
      netProfit: Math.round(totals.netProfit),
      profitability: `${totals.profitability}%`,
    },
  ]

  const buildFilterUrl = (params: Record<string, string | undefined>) => {
    const base = "/reports/finance/pnl-directions"
    const query = new URLSearchParams()
    query.set("year", String(year))
    query.set("month", String(month))
    for (const [k, v] of Object.entries(params)) {
      if (v) query.set(k, v)
    }
    return `${base}?${query.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">P&L по направлениям</h1>
            <PageHelp pageKey="reports/finance/pnl-directions" />
          </div>
          <p className="text-sm text-muted-foreground">
            Прибыль и убытки в разрезе направлений
          </p>
        </div>
        <MonthPicker />
        <ReportExport
          title="P&L по направлениям"
          filename={`pnl-directions-${monthKey}`}
          columns={[
            { header: "Направление", key: "direction", width: 24 },
            { header: "Выручка", key: "revenue", width: 14 },
            { header: "ЗП инструкторов", key: "salary", width: 16 },
            { header: "Прямые расходы", key: "directExpenses", width: 16 },
            { header: "Пост. (распр.)", key: "fixedDistributed", width: 16 },
            { header: "Маржа", key: "margin", width: 14 },
            { header: "Чист. прибыль", key: "netProfit", width: 14 },
            { header: "Рентаб.", key: "profitability", width: 10 },
          ]}
          rows={exportRows}
          period={monthName}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Период:</span>
        <Badge variant="outline">{monthName}</Badge>

        {branches.length > 1 && (
          <>
            <span className="ml-2 text-muted-foreground">Филиал:</span>
            <Link href={buildFilterUrl({})}>
              <Badge variant={!branchId ? "default" : "outline"}>Все</Badge>
            </Link>
            {branches.map((b) => (
              <Link key={b.id} href={buildFilterUrl({ branchId: b.id })}>
                <Badge variant={branchId === b.id ? "default" : "outline"}>
                  {b.name}
                </Badge>
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Выручка</p>
            <p className="text-2xl font-bold text-green-600">
              {formatMoney(totals.revenue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Маржа</p>
            <p
              className={`text-2xl font-bold ${totals.margin >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatMoney(totals.margin)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Чистая прибыль</p>
            <p
              className={`text-2xl font-bold ${totals.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatMoney(totals.netProfit)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Рентабельность</p>
            <p
              className={`text-2xl font-bold ${totals.profitability >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {totals.profitability}%
            </p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных за период
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Финансовый результат по направлениям
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Направление</TableHead>
                    <TableHead className="text-right">Выручка</TableHead>
                    <TableHead className="text-right">ЗП инструкт.</TableHead>
                    <TableHead className="text-right">Прямые расх.</TableHead>
                    <TableHead className="text-right">Пост. (распр.)</TableHead>
                    <TableHead className="text-right">Маржа</TableHead>
                    <TableHead className="text-right">Чист. прибыль</TableHead>
                    <TableHead className="text-right">Рентаб.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right text-green-700">
                        {formatMoney(r.revenue)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatMoney(r.salary)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatMoney(r.directExpenses)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {formatMoney(r.fixedDistributed)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${r.margin >= 0 ? "text-green-700" : "text-red-700"}`}
                      >
                        {formatMoney(r.margin)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${r.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}
                      >
                        {formatMoney(r.netProfit)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${r.profitability >= 0 ? "text-green-700" : "text-red-700"}`}
                      >
                        {r.profitability}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Итого</TableCell>
                    <TableCell className="text-right text-green-700">
                      {formatMoney(totals.revenue)}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatMoney(totals.salary)}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatMoney(totals.directExpenses)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {formatMoney(totals.fixedDistributed)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${totals.margin >= 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {formatMoney(totals.margin)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${totals.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {formatMoney(totals.netProfit)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${totals.profitability >= 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {totals.profitability}%
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
