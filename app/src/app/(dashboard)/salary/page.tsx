import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Banknote, TrendingUp, TrendingDown, Users } from "lucide-react"
import { PaySalaryDialog } from "./pay-salary-dialog"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

export default async function SalaryPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Все активные сотрудники (кроме readonly)
  const employees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, isActive: true, role: { not: "readonly" } },
    select: {
      id: true, firstName: true, lastName: true, role: true,
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
      lesson: { select: { instructorId: true } },
    },
  })

  // Агрегация начислений по инструкторам
  const accrualsByEmployee = new Map<string, number>()
  for (const a of attendances) {
    const empId = a.lesson.instructorId
    accrualsByEmployee.set(empId, (accrualsByEmployee.get(empId) || 0) + Number(a.instructorPayAmount))
  }

  // Премии и штрафы за месяц
  const adjustments = await db.salaryAdjustment.findMany({
    where: { tenantId, periodYear: year, periodMonth: month },
    select: { employeeId: true, type: true, amount: true },
  })

  const bonusesByEmployee = new Map<string, number>()
  const penaltiesByEmployee = new Map<string, number>()
  for (const a of adjustments) {
    if (a.type === "bonus") {
      bonusesByEmployee.set(a.employeeId, (bonusesByEmployee.get(a.employeeId) || 0) + Number(a.amount))
    } else {
      penaltiesByEmployee.set(a.employeeId, (penaltiesByEmployee.get(a.employeeId) || 0) + Number(a.amount))
    }
  }

  // Выплаты за месяц
  const salaryPayments = await db.salaryPayment.findMany({
    where: { tenantId, periodYear: year, periodMonth: month },
    select: { employeeId: true, amount: true },
  })

  const paidByEmployee = new Map<string, number>()
  for (const p of salaryPayments) {
    paidByEmployee.set(p.employeeId, (paidByEmployee.get(p.employeeId) || 0) + Number(p.amount))
  }

  // Таблица
  const rows = employees.map((emp) => {
    const name = [emp.lastName, emp.firstName].filter(Boolean).join(" ") || "Без имени"
    const accrued = accrualsByEmployee.get(emp.id) || 0
    const bonuses = bonusesByEmployee.get(emp.id) || 0
    const penalties = penaltiesByEmployee.get(emp.id) || 0
    const paid = paidByEmployee.get(emp.id) || 0
    const remaining = accrued + bonuses - penalties - paid
    return { id: emp.id, name, role: emp.role, accrued, bonuses, penalties, paid, remaining }
  }).filter(r => r.accrued > 0 || r.bonuses > 0 || r.penalties > 0 || r.paid > 0 || r.remaining !== 0)

  // Если нет данных, покажем всех с начислениями = 0
  const displayRows = rows.length > 0 ? rows : employees.map((emp) => ({
    id: emp.id,
    name: [emp.lastName, emp.firstName].filter(Boolean).join(" ") || "Без имени",
    role: emp.role,
    accrued: 0, bonuses: 0, penalties: 0, paid: 0, remaining: 0,
  }))

  const totalAccrued = displayRows.reduce((s, r) => s + r.accrued, 0)
  const totalBonuses = displayRows.reduce((s, r) => s + r.bonuses, 0)
  const totalPenalties = displayRows.reduce((s, r) => s + r.penalties, 0)
  const totalPaid = displayRows.reduce((s, r) => s + r.paid, 0)
  const totalRemaining = displayRows.reduce((s, r) => s + r.remaining, 0)

  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  const monthName = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  const summary = [
    { title: "Начислено", value: formatMoney(totalAccrued), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Премии", value: formatMoney(totalBonuses), icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { title: "Штрафы", value: formatMoney(totalPenalties), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { title: "Выплачено", value: formatMoney(totalPaid), icon: Banknote, color: "text-purple-600", bg: "bg-purple-50" },
    { title: "Осталось", value: formatMoney(totalRemaining), icon: Users, color: "text-orange-600", bg: "bg-orange-50" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Зарплата</h1>
        <PaySalaryDialog
          employees={displayRows.map(r => ({ id: r.id, name: r.name, remaining: r.remaining }))}
          accounts={accounts}
          periodYear={year}
          periodMonth={month}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ведомость</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                  <TableHead className="text-right">Премии</TableHead>
                  <TableHead className="text-right">Штрафы</TableHead>
                  <TableHead className="text-right">Выплачено</TableHead>
                  <TableHead className="text-right">Осталось</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{ROLE_LABELS[r.role] || r.role}</Badge></TableCell>
                    <TableCell className="text-right">{formatMoney(r.accrued)}</TableCell>
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
    </div>
  )
}
