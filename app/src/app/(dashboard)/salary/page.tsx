import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeEmployee } from "@/lib/branch-scope"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Banknote, TrendingUp, TrendingDown, Users, ChevronRight } from "lucide-react"
import Link from "next/link"
import { PoolPiecePayDialog } from "./pool-piece-pay-dialog"
import { PoolOkladPayDialog } from "./pool-oklad-pay-dialog"
import { SalaryCorrections } from "./salary-corrections"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"
import { getRoleNames, getOrgUiSettings } from "@/lib/role-names"
import { formatMoney as fmtCurrency } from "@/lib/currency"
import { ConductedPaymentsList } from "@/components/salary/conducted-payments-list"
import { splitEmployeeByKind } from "@/lib/salary/kind-split"
import { okladForPeriod } from "@/lib/salary/oklad-for-period"
import { computePriorPieceBalances } from "@/lib/salary/prior-piece-balance"

export default async function SalaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const roleNames = await getRoleNames(tenantId)
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  const formatMoney = (amount: number) => fmtCurrency(amount, currency)

  const sp = await searchParams
  const activeTab = sp.tab === "salary" ? "salary" : "piece"
  const { year, month } = getMonthFromParams(sp)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Выплаты проводят только владелец/управляющий (как POST /api/salary-payments и
  // карточный API): иначе кнопка «Провести выплату» упёрлась бы в 403 при загрузке.
  const canPay = session.user.role === "owner" || session.user.role === "manager"

  // ADM-04: инструктор видит только свою строку (salary.own); админ — только
  // сотрудников своих филиалов (плюс кросс-филиальных). Owner/manager — всех.
  const employeeFilter =
    session.user.role === "instructor"
      ? { id: session.user.employeeId }
      : scopeEmployee(scope)

  // Все активные сотрудники (кроме readonly)
  const employees = await db.employee.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      role: { not: "readonly" },
      ...employeeFilter,
    },
    select: {
      id: true, firstName: true, lastName: true, role: true,
      monthlySalary: true, okladFrom: true,
      salaryRates: { select: { scheme: true, ratePerStudent: true, ratePerLesson: true, fixedPerShift: true } },
    },
    orderBy: { lastName: "asc" },
  })

  // Начисления из посещений за текущий месяц
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      instructorPayEnabled: true,
    },
    select: {
      instructorPayAmount: true,
      lesson: { select: { instructorId: true, substituteInstructorId: true } },
    },
  })

  // Агрегация начислений по инструкторам (замена → заменяющему)
  const accrualsByEmployee = new Map<string, number>()
  const substituteLessonCount = new Map<string, number>()
  for (const a of attendances) {
    const empId = a.lesson.substituteInstructorId || a.lesson.instructorId
    accrualsByEmployee.set(empId, (accrualsByEmployee.get(empId) || 0) + Number(a.instructorPayAmount))
    if (a.lesson.substituteInstructorId) {
      substituteLessonCount.set(
        a.lesson.substituteInstructorId,
        (substituteLessonCount.get(a.lesson.substituteInstructorId) || 0) + 1
      )
    }
  }

  // Премии и штрафы за месяц (с направлением: directionId → тип ЗП оклад/сделка).
  const adjustments = await db.salaryAdjustment.findMany({
    where: { tenantId, periodYear: year, periodMonth: month },
    select: { employeeId: true, type: true, amount: true, directionId: true },
  })
  const adjByEmployee = new Map<string, { directionId: string | null; type: "bonus" | "penalty"; amount: number }[]>()
  for (const a of adjustments) {
    const list = adjByEmployee.get(a.employeeId) ?? []
    list.push({ directionId: a.directionId, type: a.type as "bonus" | "penalty", amount: Number(a.amount) })
    adjByEmployee.set(a.employeeId, list)
  }

  // Выплаты за месяц — по СТРОКАМ (directionId), чтобы разделить оклад/сделку
  // (одна выплата бывает смешанной; тип в БД не хранится — атрибуция по направлению).
  const paymentItems = await db.salaryPaymentItem.findMany({
    where: { tenantId, salaryPayment: { periodYear: year, periodMonth: month } },
    select: { employeeId: true, directionId: true, amount: true },
  })
  const itemsByEmployee = new Map<string, { directionId: string | null; amount: number }[]>()
  for (const it of paymentItems) {
    const list = itemsByEmployee.get(it.employeeId) ?? []
    list.push({ directionId: it.directionId, amount: Number(it.amount) })
    itemsByEmployee.set(it.employeeId, list)
  }

  // Классификация по типу ЗП:
  //  • «Оклады» — окладники (monthlySalary>0).
  //  • «Сдельная» — у кого есть сделочная активность (начисление/выплата/корректировка).
  //  Совмещающий попадает в обе вкладки (в каждой — своя часть; см. lib/salary/kind-split).
  // Оклад сотрудника за ВЫБРАННЫЙ месяц: гейт по дате начала оклада (okladFrom) +
  // пропорция неполного первого месяца. Раньше оклад начислялся за любой месяц —
  // окладник, заведённый в августе, всплывал в июле (см. lib/salary/oklad-for-period).
  const okladByEmployee = new Map(
    employees.map((e) => [
      e.id,
      okladForPeriod({
        monthlySalary: Number(e.monthlySalary) || 0,
        okladFrom: e.okladFrom,
        periodYear: year,
        periodMonth: month,
      }),
    ]),
  )
  const okladIds = new Set(employees.filter((e) => (okladByEmployee.get(e.id) || 0) > 0).map((e) => e.id))

  // «Доначислено» — накопленный сделочный остаток прошлых периодов (только вкладка
  // «Сдельная»): плюс = недоплата (в т.ч. ретро-отметки после выплаты), минус —
  // переплата. Входит в «Осталось» (к выплате). Считаем только по видимым (scoped)
  // сотрудникам. См. lib/salary/prior-piece-balance.
  const showDonachisleno = activeTab === "piece"
  const priorMap = showDonachisleno
    ? await computePriorPieceBalances(db, tenantId, year, month, { employeeIds: employees.map((e) => e.id) })
    : new Map<string, { balance: number; topDirectionId: string | null }>()

  // Каждая строка несёт РАЗДЕЛЁННЫЕ по типу ЗП суммы: начислено/выплачено/остаток
  // на вкладке — только своя часть, вкладки больше не смешиваются.
  const rows = employees.map((emp) => {
    const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ") || "Без имени"
    const split = splitEmployeeByKind({
      monthlySalary: okladByEmployee.get(emp.id) || 0,
      pieceAccrued: accrualsByEmployee.get(emp.id) || 0,
      paymentItems: itemsByEmployee.get(emp.id) ?? [],
      adjustments: adjByEmployee.get(emp.id) ?? [],
    })
    const donachisleno = showDonachisleno ? (priorMap.get(emp.id)?.balance ?? 0) : 0
    const tab = activeTab === "salary" ? split.salary : split.piece
    const pieceActive = split.piece.accrued !== 0 || split.piece.paid !== 0 || split.piece.bonuses !== 0 || split.piece.penalties !== 0
    const substitutions = substituteLessonCount.get(emp.id) || 0
    return {
      id: emp.id, name, role: emp.role,
      accrued: tab.accrued, bonuses: tab.bonuses, penalties: tab.penalties, paid: tab.paid,
      donachisleno,
      // «Осталось» = остаток месяца + доначислено (к выплате с учётом прошлых периодов).
      remaining: Math.round((tab.remaining + donachisleno) * 100) / 100,
      pieceActive, substitutions,
    }
  })

  // Наборы строк по вкладкам: «Сдельная» — со сделочной активностью ИЛИ с ненулевым
  // доначислением (долг/переплата прошлых периодов при нулевой активности месяца);
  // «Оклады» — окладники (monthlySalary>0). Пустая вкладка → пустая ведомость.
  const pieceRows = rows.filter((r) => r.pieceActive || r.donachisleno !== 0)
  const salaryRows = rows.filter((r) => okladIds.has(r.id))
  const displayRows = activeTab === "salary" ? salaryRows : pieceRows

  const totalAccrued = displayRows.reduce((s, r) => s + r.accrued, 0)
  const totalDonachisleno = displayRows.reduce((s, r) => s + r.donachisleno, 0)
  const totalBonuses = displayRows.reduce((s, r) => s + r.bonuses, 0)
  const totalPenalties = displayRows.reduce((s, r) => s + r.penalties, 0)
  const totalPaid = displayRows.reduce((s, r) => s + r.paid, 0)
  const totalRemaining = displayRows.reduce((s, r) => s + r.remaining, 0)

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  const summary = [
    { title: "Начислено", value: formatMoney(totalAccrued), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
    ...(showDonachisleno
      ? [{ title: "Доначислено", value: formatMoney(totalDonachisleno), icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-50" }]
      : []),
    { title: "Премии", value: formatMoney(totalBonuses), icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { title: "Штрафы", value: formatMoney(totalPenalties), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { title: "Выплачено", value: formatMoney(totalPaid), icon: Banknote, color: "text-purple-600", bg: "bg-purple-50" },
    { title: "Осталось", value: formatMoney(totalRemaining), icon: Users, color: "text-orange-600", bg: "bg-orange-50" },
  ]

  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // Данные для экспорта
  const salaryExportRows = displayRows.map((r) => ({
    name: r.name,
    role: roleNames[r.role as keyof typeof roleNames] || r.role,
    accrued: Math.round(r.accrued),
    ...(showDonachisleno ? { donachisleno: Math.round(r.donachisleno) } : {}),
    bonuses: Math.round(r.bonuses),
    penalties: Math.round(r.penalties),
    paid: Math.round(r.paid),
    remaining: Math.round(r.remaining),
  }))

  const salaryExportColumns = [
    { header: "Сотрудник", key: "name", width: 25 },
    { header: "Роль", key: "role", width: 16 },
    { header: "Начислено", key: "accrued", width: 14 },
    ...(showDonachisleno ? [{ header: "Доначислено", key: "donachisleno", width: 14 }] : []),
    { header: "Премии", key: "bonuses", width: 14 },
    { header: "Штрафы", key: "penalties", width: 14 },
    { header: "Выплачено", key: "paid", width: 14 },
    { header: "Осталось", key: "remaining", width: 14 },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold">Зарплата</h1>
          <PageHelp pageKey="salary" />
          <MonthPicker />
          <ReportExport
            title="Зарплатная ведомость"
            filename={`salary-${monthKey}`}
            columns={salaryExportColumns}
            rows={salaryExportRows}
            period={monthName}
          />
        </div>
        <div className="flex items-center gap-2">
          {canPay && (activeTab === "salary" ? (
            <PoolOkladPayDialog
              employees={displayRows.map(r => ({ id: r.id, name: r.name }))}
              periodYear={year}
              periodMonth={month}
            />
          ) : (
            <PoolPiecePayDialog
              employees={displayRows.map(r => ({ id: r.id, name: r.name }))}
              periodYear={year}
              periodMonth={month}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b pb-2">
        <div className="flex items-center gap-2">
          <Link href={`/salary?year=${year}&month=${month}&tab=piece`}>
            <Badge variant={activeTab === "piece" ? "default" : "outline"} className="cursor-pointer h-8 px-4 text-sm">Сдельная</Badge>
          </Link>
          <Link href={`/salary?year=${year}&month=${month}&tab=salary`}>
            <Badge variant={activeTab === "salary" ? "default" : "outline"} className="cursor-pointer h-8 px-4 text-sm">Оклады</Badge>
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Период:</span>
          <Badge variant="outline">{monthName}</Badge>
        </div>
      </div>

      <div className={`grid gap-4 sm:grid-cols-3 ${showDonachisleno ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
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

      <SalaryCorrections year={year} month={month} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ведомость</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                  {showDonachisleno && <TableHead className="text-right">Доначислено</TableHead>}
                  <TableHead className="text-right">Премии</TableHead>
                  <TableHead className="text-right">Штрафы</TableHead>
                  <TableHead className="text-right">Выплачено</TableHead>
                  <TableHead className="text-right">Осталось</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/salary/instructor/${r.id}?year=${year}&month=${month}&kind=${activeTab}`}
                        className="text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.substitutions > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">замена ({r.substitutions})</Badge>
                      )}
                      <Link
                        href={`/salary/instructor/${r.id}?year=${year}&month=${month}&kind=${activeTab}`}
                        title="Детали / выплата"
                        className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant="outline">{roleNames[r.role as keyof typeof roleNames] || r.role}</Badge></TableCell>
                    <TableCell className="text-right">{formatMoney(r.accrued)}</TableCell>
                    {showDonachisleno && (
                      <TableCell className={`text-right ${r.donachisleno > 0 ? "text-amber-600" : r.donachisleno < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {r.donachisleno !== 0 ? formatMoney(r.donachisleno) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-green-600">{r.bonuses > 0 ? formatMoney(r.bonuses) : "—"}</TableCell>
                    <TableCell className="text-right text-red-600">{r.penalties > 0 ? formatMoney(r.penalties) : "—"}</TableCell>
                    <TableCell className="text-right text-purple-600">{r.paid > 0 ? formatMoney(r.paid) : "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${r.remaining > 0 ? "text-orange-600" : ""}`}>
                      {formatMoney(r.remaining)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>Итого</TableCell>
                  <TableCell className="text-right">{formatMoney(totalAccrued)}</TableCell>
                  {showDonachisleno && (
                    <TableCell className={`text-right ${totalDonachisleno > 0 ? "text-amber-600" : totalDonachisleno < 0 ? "text-green-600" : ""}`}>
                      {totalDonachisleno !== 0 ? formatMoney(totalDonachisleno) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right text-green-600">{totalBonuses > 0 ? formatMoney(totalBonuses) : "—"}</TableCell>
                  <TableCell className="text-right text-red-600">{totalPenalties > 0 ? formatMoney(totalPenalties) : "—"}</TableCell>
                  <TableCell className="text-right text-purple-600">{totalPaid > 0 ? formatMoney(totalPaid) : "—"}</TableCell>
                  <TableCell className="text-right">{formatMoney(totalRemaining)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConductedPaymentsList year={year} month={month} kind={activeTab === "salary" ? "salary" : "piece"} />
    </div>
  )
}
