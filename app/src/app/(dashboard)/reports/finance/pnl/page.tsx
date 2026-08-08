import { PageHelp } from "@/components/page-help"
import { PnlPeriodPicker } from "@/components/pnl-period-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, SplitSquareVertical } from "lucide-react"
import Link from "next/link"
import { BackButton } from "@/components/back-button"
import { DrilldownAmount } from "@/components/drilldown-amount"
import { ReportExport } from "@/components/report-export"
import { expenseFetchWindow } from "@/lib/expense-amortization"
import {
  computePnlView,
  enumerateMonths,
  monthKey,
  monthKeyOfDate,
  type PnlRawData,
  type PnlView,
} from "@/lib/pnl-view"
import { computePnlDecomposition, type PnlDecompRawData, type DecompView } from "@/lib/pnl-decomposition"
import { PnlDecompositionTree } from "@/components/pnl-decomposition-tree"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatMoney as fmtCurrency } from "@/lib/currency"
import { getOrgUiSettings } from "@/lib/role-names"

export default async function PnlReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  const formatMoney = (amount: number): string => fmtCurrency(Math.round(amount), currency)

  const params = await searchParams
  // Период отчёта — произвольный диапазон месяцев from/to (YYYY-MM). Обратная
  // совместимость: одиночный месяц year/month (старые ссылки, дашборд, drill-down).
  const single = getMonthFromParams(params)
  const parseYm = (v: string | string[] | undefined, fy: number, fm: number) => {
    if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
      const [y, m] = v.split("-").map(Number)
      if (m >= 1 && m <= 12) return { year: y, month: m }
    }
    return { year: fy, month: fm }
  }
  let fromYm = parseYm(params.from, single.year, single.month)
  let toYm = parseYm(params.to, fromYm.year, fromYm.month)
  if (toYm.year * 12 + toYm.month < fromYm.year * 12 + fromYm.month) {
    const t = fromYm
    fromYm = toYm
    toYm = t
  }
  const isRange = fromYm.year !== toYm.year || fromYm.month !== toYm.month
  const fromKey = `${fromYm.year}-${String(fromYm.month).padStart(2, "0")}`
  const toKey = `${toYm.year}-${String(toYm.month).padStart(2, "0")}`
  const monthStart = new Date(Date.UTC(fromYm.year, fromYm.month - 1, 1))
  const monthEnd = new Date(Date.UTC(toYm.year, toYm.month, 0))
  const branchFilter = typeof params.branch === "string" ? params.branch : undefined

  // Список филиалов для табов «Общий | Филиал A | ...»
  const allBranches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // === Сырые строки за весь период (агрегируем помесячно в памяти) ===
  // Всегда тянем по всей сети (без branch-фильтра): срез филиала считается аллокацией
  // в computePnlView (доля расхода/прочего дохода ∝ выручке филиала). Фильтровать сырьё
  // по филиалу нельзя — иначе общие/оклад-твин расходы выпадут, а мультифилиальные
  // задвоятся между табами.
  // Выручка: списания с абонементов (chargeAmount) по дате занятия.
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
          date: true,
          group: { select: { branchId: true, directionId: true, direction: { select: { name: true } } } },
        },
      },
    },
  })

  // ЗП инструкторов (начислено из посещений) по дате занятия.
  const salaryAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      instructorPayEnabled: true,
    },
    select: {
      instructorPayAmount: true,
      lesson: { select: { date: true, group: { select: { branchId: true, directionId: true } } } },
    },
  })

  // Прочие доходы вне абонементов (Payment без subscriptionId, с incomeCategoryId).
  // В срезе филиала разносятся ∝ выручке (как общий расход) — тянем всегда.
  const otherIncomePayments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      subscriptionId: null,
      incomeCategoryId: { not: null },
      notInPnl: false, // «Не учитывать в ОПИУ» (баг #105)
      type: { in: ["incoming", "transfer_in"] },
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { amount: true, date: true, incomeCategory: { select: { id: true, name: true } } },
  })

  // Расходы — расширенным окном (±60 мес по дате платежа): период признания
  // (recognitionMode) может отличаться от даты платежа в обе стороны. Тянем по всей
  // сети — аллокация по филиалам делается в computePnlView.
  const { gte: expensesFrom, lte: expensesTo } = expenseFetchWindow(fromYm.year, fromYm.month, toYm.year, toYm.month)
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: expensesFrom, lte: expensesTo } },
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      branches: { select: { branchId: true, directionId: true } },
    },
  })

  // Имена всех направлений (для тех, у кого только прямые расходы, без выручки).
  const directions = await db.direction.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })

  // === Сборка PnlRawData ===
  const raw: PnlRawData = {
    attendances: attendances.map((a) => ({
      chargeAmount: Number(a.chargeAmount),
      ymKey: monthKeyOfDate(a.lesson.date),
      branchId: a.lesson.group.branchId,
      directionId: a.lesson.group.directionId,
      directionName: a.lesson.group.direction.name,
    })),
    salary: salaryAttendances.map((s) => ({
      amount: Number(s.instructorPayAmount),
      ymKey: monthKeyOfDate(s.lesson.date),
      branchId: s.lesson.group.branchId,
    })),
    otherIncome: otherIncomePayments.flatMap((p) =>
      p.incomeCategory
        ? [{ amount: Number(p.amount), ymKey: monthKeyOfDate(p.date), categoryId: p.incomeCategory.id, categoryName: p.incomeCategory.name }]
        : [],
    ),
    expenses: expenses.map((e) => ({
      amount: e.amount,
      date: e.date,
      recognitionMode: e.recognitionMode,
      amortizationMonths: e.amortizationMonths,
      amortizationStartDate: e.amortizationStartDate,
      categoryId: e.category.id,
      categoryName: e.category.name,
      isSalary: e.category.isSalary,
      isVariable: e.category.isVariable,
      links: e.branches.map((b) => ({ branchId: b.branchId, directionId: b.directionId })),
    })),
    directionNameById: new Map(directions.map((d) => [d.id, d.name])),
  }

  // === Сырьё для «Финрез Декомпозиции» (Филиал → Направление → Статья) ===
  // Тот же набор занятий/ЗП/расходов, что и основной P&L (гарантия reconcile). Дерево
  // считаем по всей сети; для среза филиала берём узел выбранного филиала (sliceDecomp) —
  // так расход остаётся разнесённым ∝ выручке, а филиал показывает свою долю.
  const branchNameById = new Map(allBranches.map((b) => [b.id, b.name]))
  const decompRaw: PnlDecompRawData = {
    revenue: attendances.map((a) => ({
      branchId: a.lesson.group.branchId,
      directionId: a.lesson.group.directionId,
      amount: Number(a.chargeAmount),
      ymKey: monthKeyOfDate(a.lesson.date),
    })),
    salary: salaryAttendances.map((s) => ({
      branchId: s.lesson.group.branchId,
      directionId: s.lesson.group.directionId,
      amount: Number(s.instructorPayAmount),
      ymKey: monthKeyOfDate(s.lesson.date),
    })),
    otherIncome: otherIncomePayments.flatMap((p) =>
      p.incomeCategory ? [{ categoryName: p.incomeCategory.name, amount: Number(p.amount), ymKey: monthKeyOfDate(p.date) }] : [],
    ),
    expenses: expenses.map((e) => ({
      amount: e.amount,
      date: e.date,
      recognitionMode: e.recognitionMode,
      amortizationMonths: e.amortizationMonths,
      amortizationStartDate: e.amortizationStartDate,
      categoryName: e.category.name,
      links: e.branches.map((b) => ({ branchId: b.branchId, directionId: b.directionId })),
    })),
    branchNameById,
    directionNameById: new Map(directions.map((d) => [d.id, d.name])),
  }

  // Срез дерева декомпозиции на выбранный филиал (или всё дерево в общем виде).
  function sliceDecomp(v: DecompView): DecompView {
    if (!branchFilter) return v
    const branches = v.branches.filter((b) => b.branchId === branchFilter)
    const income = Math.round(branches.reduce((s, b) => s + b.income, 0) * 100) / 100
    const expense = Math.round(branches.reduce((s, b) => s + b.expense, 0) * 100) / 100
    return { branches, totals: { income, expense, profit: Math.round((income - expense) * 100) / 100 } }
  }

  const fromKeyNum = monthKey(fromYm.year, fromYm.month)
  const toKeyNum = monthKey(toYm.year, toYm.month)
  const total = computePnlView(fromKeyNum, toKeyNum, raw, branchFilter)
  const months = enumerateMonths(fromYm.year, fromYm.month, toYm.year, toYm.month)

  // Колонки декомпозиции: «Весь период» + карточка на каждый месяц (только для диапазона).
  type PnlColumn = { key: string; title: string; view: PnlView; decomp: DecompView; drill: { month: string; from: string; to: string } }
  const periodColumn: PnlColumn = {
    key: "total",
    title: isRange ? "Весь период" : "",
    view: total,
    decomp: sliceDecomp(computePnlDecomposition(fromKeyNum, toKeyNum, decompRaw)),
    drill: { month: fromKey, from: fromKey, to: toKey },
  }
  const monthColumns: PnlColumn[] = isRange
    ? months.map((mm) => {
        const mk = `${mm.year}-${String(mm.month).padStart(2, "0")}`
        return {
          key: mk,
          title: mm.label,
          view: computePnlView(mm.key, mm.key, raw, branchFilter),
          decomp: sliceDecomp(computePnlDecomposition(mm.key, mm.key, decompRaw)),
          drill: { month: mk, from: mk, to: mk },
        }
      })
    : []
  const pnlColumns: PnlColumn[] = [periodColumn, ...monthColumns]

  const fmtMonthYear = (y: number, m: number) =>
    new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const monthName = isRange
    ? `${fmtMonthYear(fromYm.year, fromYm.month)} — ${fmtMonthYear(toYm.year, toYm.month)}`
    : fmtMonthYear(fromYm.year, fromYm.month)
  const periodKey = isRange ? `${fromKey}_${toKey}` : fromKey

  // Строки P&L из числового вида. drillField → drill-down (categoryId/incomeCategoryId).
  type PnlRow = {
    label: string
    amount: number
    bold: boolean
    color: string
    drillField?: string
    drillCategoryId?: string
    drillIncomeCategoryId?: string
  }
  function buildPnlRows(v: PnlView): PnlRow[] {
    return [
      { label: "Выручка (отработанные занятия)", amount: v.revenue, bold: true, color: "text-green-700", drillField: "revenue" },
      { label: "", amount: 0, bold: false, color: "" },
      { label: "Переменные расходы:", amount: v.totalVariableCosts, bold: true, color: "text-red-700" },
      { label: "  ЗП инструкторов (начислено)", amount: v.totalSalaryAccrued, bold: false, color: "text-red-600", drillField: "salary" },
      ...v.expenseCategories
        .filter((c) => c.isVariable)
        .sort((a, b) => b.amount - a.amount)
        .map((c) => ({ label: `  ${c.name}`, amount: c.amount, bold: false, color: "text-red-600", drillField: "expense-category", drillCategoryId: c.categoryId })),
      { label: "", amount: 0, bold: false, color: "" },
      { label: "Маржа (Выручка − Переменные)", amount: v.margin, bold: true, color: v.margin >= 0 ? "text-green-700" : "text-red-700" },
      { label: "", amount: 0, bold: false, color: "" },
      { label: "Постоянные расходы:", amount: v.fixedExpenses, bold: true, color: "text-orange-700", drillField: "expenses" },
      ...v.expenseCategories
        .filter((c) => !c.isVariable)
        .sort((a, b) => b.amount - a.amount)
        .map((c) => ({ label: `  ${c.name}`, amount: c.amount, bold: false, color: "text-orange-600", drillField: "expense-category", drillCategoryId: c.categoryId })),
      ...(v.otherIncomeByCategory.length > 0
        ? [
            { label: "", amount: 0, bold: false, color: "" } as PnlRow,
            { label: "Прочие доходы:", amount: v.totalOtherIncome, bold: true, color: "text-green-700", drillField: "other-income" } as PnlRow,
            ...v.otherIncomeByCategory.map((c) => ({ label: `  ${c.name}`, amount: c.amount, bold: false, color: "text-green-600", drillField: "other-income-category", drillIncomeCategoryId: c.id } as PnlRow)),
          ]
        : []),
      { label: "", amount: 0, bold: false, color: "" },
      { label: "Чистая прибыль", amount: v.netProfit, bold: true, color: v.netProfit >= 0 ? "text-green-700" : "text-red-700" },
      { label: "Рентабельность", amount: v.profitability, bold: true, color: v.profitability >= 0 ? "text-green-700" : "text-red-700" },
    ]
  }

  const activeBranchName = branchFilter
    ? allBranches.find((b) => b.id === branchFilter)?.name ?? "—"
    : "Все филиалы"

  // Экспорт — по всему периоду (колонка «Весь период»).
  const exportRows = buildPnlRows(total)
    .filter((r) => r.label !== "")
    .map((r) => ({ label: r.label, amount: r.label === "Рентабельность" ? `${r.amount.toFixed(1)}%` : Math.round(r.amount) }))

  function branchHref(bId: string | undefined): string {
    const sp = new URLSearchParams()
    sp.set("from", fromKey)
    sp.set("to", toKey)
    if (bId) sp.set("branch", bId)
    return `?${sp.toString()}`
  }

  // ── Рендер одной колонки «Отчёт P&L» ──
  function renderPnlTable(col: PnlColumn) {
    const rows = buildPnlRows(col.view)
    return (
      <Table className="w-auto">
        <TableBody>
          {rows.map((row, i) => {
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
                      month={col.drill.month}
                      title={`Детализация: ${row.label.trim()}${branchFilter ? ` — ${activeBranchName}` : ""}`}
                      className={row.color}
                      extraParams={{
                        categoryId: row.drillCategoryId,
                        incomeCategoryId: row.drillIncomeCategoryId,
                        branchId: branchFilter,
                        from: col.drill.from,
                        to: col.drill.to,
                      }}
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
    )
  }

  // ── Рендер одной колонки «% распределения финреза» ──
  function renderDistributionTable(v: PnlView) {
    return (
      <Table className="w-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Статья</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead className="text-right">% от выручки</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {v.distributionArticles.map((a) => (
            <TableRow key={a.category}>
              <TableCell className="font-medium">{a.category}</TableCell>
              <TableCell className="text-right">{formatMoney(a.amount)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{a.percentOfRevenue}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  // ── Рендер одной колонки «Распределение постоянных расходов по направлениям» ──
  function renderDirectionsTable(v: PnlView) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Направление</TableHead>
            <TableHead className="text-right">Выручка</TableHead>
            <TableHead className="text-right">Доля</TableHead>
            <TableHead className="text-right">Пост. (распред.)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {v.directionEntries.map((dir) => {
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
                          {dir.directFixedItems.map((item, idx) => (
                            <div key={`direct-${idx}`} className="flex justify-between gap-4">
                              <span>{item.category} <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">прямой</Badge></span>
                              <span>{formatMoney(item.amount)}</span>
                            </div>
                          ))}
                          {(v.distributionByKey[dir.directionId] ?? []).map((item, idx) => (
                            <div key={`dist-${idx}`} className="flex justify-between gap-4">
                              <span>{item.category}</span>
                              <span>{formatMoney(item.distributedAmount)}</span>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            )
          })}
          <TableRow className="font-bold border-t-2">
            <TableCell>Итого</TableCell>
            <TableCell className="text-right text-green-700">{formatMoney(v.revenue)}</TableCell>
            <TableCell className="text-right">100%</TableCell>
            <TableCell className="text-right text-orange-600">{formatMoney(v.fixedExpenses)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  // Обёртка секции: одна карточка (один месяц) или горизонтальный ряд карточек
  // [Весь период | Месяц 1 | Месяц 2 | …] со скроллом при диапазоне.
  const sectionRow = "flex gap-4 overflow-x-auto pb-2"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackButton fallbackHref="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Финансовый результат (P&L)</h1>
            <PageHelp pageKey="reports/finance/pnl" />
          </div>
          <p className="text-sm text-muted-foreground">Выручка + Прочие доходы − Расходы − ЗП = Прибыль</p>
        </div>
        <PnlPeriodPicker />
        <ReportExport
          title={`Финансовый результат (P&L) — ${activeBranchName}`}
          filename={`pnl-${periodKey}${branchFilter ? `-${branchFilter.slice(0, 8)}` : ""}`}
          columns={[
            { header: "Показатель", key: "label", width: 40 },
            { header: "Сумма", key: "amount", width: 18 },
          ]}
          rows={exportRows}
          period={monthName}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
        <span className="ml-2">Филиал:</span>
        <Badge variant="outline">{activeBranchName}</Badge>
      </div>

      {/* Табы по филиалам */}
      {allBranches.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          <Link href={branchHref(undefined)}>
            <Badge variant={!branchFilter ? "default" : "outline"} className="cursor-pointer">Все филиалы</Badge>
          </Link>
          {allBranches.map((b) => (
            <Link key={b.id} href={branchHref(b.id)}>
              <Badge variant={branchFilter === b.id ? "default" : "outline"} className="cursor-pointer">{b.name}</Badge>
            </Link>
          ))}
          {branchFilter && (
            <span className="text-xs text-muted-foreground ml-2">Расходы и прочие доходы разнесены по филиалам ∝ выручке</span>
          )}
        </div>
      )}

      {/* KPI за весь период */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Выручка</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(total.revenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Маржа</p>
            <p className={`text-2xl font-bold ${total.margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatMoney(total.margin)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Чистая прибыль</p>
            <p className={`text-2xl font-bold ${total.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatMoney(total.netProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Рентабельность</p>
            <p className={`text-2xl font-bold ${total.profitability >= 0 ? "text-green-600" : "text-red-600"}`}>{total.profitability.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Отчёт P&L: карточка за период + карточки по месяцам */}
      <div>
        {isRange && <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Отчёт P&L по месяцам</h2>}
        <div className={sectionRow}>
          {pnlColumns.map((col) => (
            <Card key={col.key} className="shrink-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{col.title || "Отчёт P&L"}</CardTitle>
              </CardHeader>
              <CardContent>{renderPnlTable(col)}</CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* % распределения финреза */}
      {pnlColumns.some((c) => c.view.distributionArticles.length > 0) && (
        <div>
          {isRange && <h2 className="mb-2 text-sm font-semibold text-muted-foreground">% распределения финреза по месяцам</h2>}
          <div className={sectionRow}>
            {pnlColumns
              .filter((c) => c.view.distributionArticles.length > 0)
              .map((col) => (
                <Card key={col.key} className="shrink-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{col.title || "% распределения финреза"}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">Доля каждой статьи расходов и ЗП в выручке</p>
                  </CardHeader>
                  <CardContent className="p-0 pb-4">{renderDistributionTable(col.view)}</CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* FIN-16: Распределение постоянных расходов по направлениям */}
      {pnlColumns.some((c) => c.view.directionEntries.length > 0 && c.view.fixedExpenses > 0) && (
        <div>
          {isRange && <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Распределение постоянных расходов по направлениям — по месяцам</h2>}
          <div className={sectionRow}>
            {pnlColumns
              .filter((c) => c.view.directionEntries.length > 0 && c.view.fixedExpenses > 0)
              .map((col) => (
                <Card key={col.key} className="shrink-0">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <SplitSquareVertical className="size-4 text-orange-600" />
                      <CardTitle className="text-base">{col.title || "Распределение постоянных расходов по направлениям"}</CardTitle>
                      {!isRange && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger><Badge variant="outline" className="text-xs">авто</Badge></TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">Расходы с указанным направлением относятся к нему напрямую. Остальные постоянные распределяются пропорционально выручке направлений.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Прямые — целиком к направлению; остальные — пропорционально выручке.</p>
                  </CardHeader>
                  <CardContent>{renderDirectionsTable(col.view)}</CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Финрез Декомпозиция: Филиал → Направление → Статья */}
      {pnlColumns.some((c) => c.decomp.branches.length > 0) && (
        <div>
          {isRange && <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Финрез Декомпозиция — по месяцам</h2>}
          <div className={sectionRow}>
            {pnlColumns
              .filter((c) => c.decomp.branches.length > 0)
              .map((col) => (
                <Card key={col.key} className="shrink-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{col.title || "Финрез Декомпозиция"}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Филиал → Направление → Статья. Расходы разнесены пропорционально выручке.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <PnlDecompositionTree branches={col.decomp.branches} totals={col.decomp.totals} currency={currency} />
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
