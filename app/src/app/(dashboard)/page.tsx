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
import {
  Users, TrendingUp, TrendingDown, AlertTriangle,
  Clock, BarChart3, Cake,
} from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"
import { OnboardingWizard } from "@/components/onboarding-wizard"
import { DashboardGrid } from "@/components/dashboard-grid"
import { DashboardSettingsButton } from "@/components/dashboard-settings"
import { DashboardTasksTable, type DashboardTaskRow } from "@/components/dashboard-tasks-table"
import { computeMonthlySalaryForecast } from "@/lib/salary/forecast-month"
import { computeActiveSubscriptionsByBranch } from "@/lib/dashboard/active-subscriptions"
import { computeUpcomingBirthdays } from "@/lib/dashboard/upcoming-birthdays"
import { computeSalesFunnel, summarizeSalesFunnel } from "@/lib/reports/sales-funnel"
import { branchScopeFromSession } from "@/lib/branch-scope"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Проверяем онбординг (только для владельца — мастер настройки создаёт филиал/сотрудников и т.п.)
  if (session.user.role === "owner") {
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { onboardingCompleted: true, name: true, inn: true },
    })

    if (org && !org.onboardingCompleted) {
      return (
        <div className="space-y-6">
          <h1 className="text-2xl font-bold">Настройка организации</h1>
          <OnboardingWizard orgName={org.name} orgInn={org.inn} />
        </div>
      )
    }
  }

  // Инструктору (педагогу) дашборд с виджетами не показываем — это управленческая
  // сводка. Отдаём простую главную со ссылками на его рабочие поверхности. Выходим
  // до загрузки данных виджетов — не считаем и не отдаём лишнего.
  if (session.user.role === "instructor") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Главная</h1>
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          <p className="text-base text-foreground">Здравствуйте, {session.user.name}!</p>
          <p className="mt-2">
            Откройте{" "}
            <Link href="/schedule" className="text-primary hover:underline">Расписание</Link>{" "}
            или{" "}
            <Link href="/lessons" className="text-primary hover:underline">Занятия</Link>
            , чтобы посмотреть свои занятия и отметить посещаемость.
          </p>
        </div>
      </div>
    )
  }

  const { year, month } = getMonthFromParams(await searchParams)
  const now = new Date()
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))
  const today = new Date(Date.UTC(year, month - 1, now.getDate()))

  // === МЕТРИКИ ===

  // Активные ученики (уникальные клиенты с активными абонементами)
  const activeSubscriptions = await db.subscription.count({
    where: { tenantId, deletedAt: null, status: "active" },
  })

  // Доходы за месяц — приходы из ДДС (фактически полученные деньги).
  // Не путаем с выручкой ОПИУ (отработанные занятия). На дашборде показываем
  // именно деньги в кассу/на счёт. refund и transfer_in не считаем — это не
  // «новые деньги», а возврат/внутреннее перемещение.
  const monthIncomeData = await db.payment.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
      type: "incoming",
    },
    _sum: { amount: true },
  })
  const monthIncome = Number(monthIncomeData._sum.amount || 0)

  // Расходы за месяц
  const monthExpensesData = await db.expense.aggregate({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    _sum: { amount: true },
  })
  const monthExpenses = Number(monthExpensesData._sum.amount || 0)

  // Должники (плановый долг): клиенты с непогашенным остатком по не-отчисленным
  // абонементам (balance>0). Совпадает с вкладкой «Плановый долг» страницы
  // /finance/debtors, куда ведёт виджет. Перенесённый/импортный долг
  // (отрицательный clientBalance, не привязанный к абонементу) сюда НЕ входит —
  // он виден на странице должников.
  const debtors = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      subscriptions: {
        some: {
          deletedAt: null,
          status: { not: "withdrawn" },
          balance: { gt: 0 },
        },
      },
    },
    select: {
      subscriptions: {
        where: {
          deletedAt: null,
          status: { not: "withdrawn" },
          balance: { gt: 0 },
        },
        select: { balance: true },
      },
    },
  })
  const debtorCount = debtors.length
  const totalDebt = debtors.reduce(
    (s, d) => s + d.subscriptions.reduce((acc, sub) => acc + Number(sub.balance), 0),
    0,
  )

  // Задачи на сегодня (и просроченные). Для админа/менеджера/владельца — все
  // задачи тенанта; для прочих ролей (инструктор, readonly) — только свои.
  const role = session.user.role
  const seesAllTasks =
    role === "owner" || role === "manager" || role === "admin"
  const employeeId = session.user.employeeId ?? null
  const todayTasks =
    !seesAllTasks && !employeeId
      ? []
      : await db.task.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: "pending",
            dueDate: { lte: today },
            ...(seesAllTasks ? {} : { assignedTo: employeeId! }),
          },
          select: {
            id: true,
            title: true,
            dueDate: true,
          },
          orderBy: { dueDate: "asc" },
          take: 15,
        })

  // Дата события вытаскивается из заголовка задач, у которых она есть в
  // скобках (`(YYYY-MM-DD)` для trial_reminder, `(DD.MM.YYYY)` для
  // no_show_review). Для остальных — dueDate.
  const todayIso = today.toISOString().slice(0, 10)
  const todayTaskRows: DashboardTaskRow[] = todayTasks.map((t) => {
    const iso = t.title.match(/\((\d{4}-\d{2}-\d{2})\)/)
    const ru = t.title.match(/\((\d{2})\.(\d{2})\.(\d{4})\)/)
    let eventDateIso: string
    if (iso) {
      eventDateIso = iso[1]
    } else if (ru) {
      eventDateIso = `${ru[3]}-${ru[2]}-${ru[1]}`
    } else {
      eventDateIso = t.dueDate.toISOString().slice(0, 10)
    }
    const dueIso = t.dueDate.toISOString().slice(0, 10)
    return {
      id: t.id,
      // Из заголовка убираем дату в скобках — она уйдёт в отдельную колонку.
      title: t.title
        .replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "")
        .replace(/\s*\(\d{2}\.\d{2}\.\d{4}\)\s*$/, "")
        .trim(),
      eventDate: eventDateIso,
      isOverdue: dueIso < todayIso,
    }
  })

  // Неотмеченные занятия — только те, что фактически уже закончились.
  // Урезаем по дате на стороне БД (≤ сегодня), а сегодняшние занятия,
  // у которых endTime ещё не наступило, отсекаем в JS — sqlite/postgres
  // не умеет элегантно сравнить time-of-day + duration без raw SQL.
  const unmarkedRaw = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: monthStart, lte: today },
      status: "scheduled",
      attendances: { none: {} },
    },
    include: {
      group: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: "desc" },
    take: 30,
  })
  const nowMs = Date.now()
  const unmarkedLessons = unmarkedRaw
    .filter((l) => {
      const [hh, mm] = l.startTime.split(":").map(Number)
      // date — DATE без TZ, считаем как локальную дату.
      const start = new Date(l.date)
      start.setHours(hh || 0, mm || 0, 0, 0)
      const end = start.getTime() + (l.durationMinutes || 60) * 60_000
      return end <= nowMs
    })
    .slice(0, 5)

  // Воронка продаж (CRM-13) — те же цифры, что и в отчёте /reports/crm/funnel:
  // событийная воронка по заявкам за месяц, на дашборде каждый этап одной
  // суммарной цифрой (текущий месяц + перетекающие). ADM-04: scope сессии.
  const funnelMonth = summarizeSalesFunnel(
    await computeSalesFunnel(tenantId, year, month, {
      withRows: false,
      scope: branchScopeFromSession(session.user.allowedBranchIds),
    })
  )
  const funnelStageColors: Record<string, string> = {
    lead: "bg-blue-500",
    application: "bg-sky-500",
    trial: "bg-cyan-500",
    trial_attended: "bg-teal-500",
    won: "bg-green-500",
  }
  const funnelStages = funnelMonth.map((s) => ({
    stage: s.label,
    count: s.count,
    color: funnelStageColors[s.key] ?? "bg-gray-400",
  }))
  const maxFunnel = Math.max(...funnelStages.map(f => f.count), 1)

  // Заполняемость групп — на дашборд выводим только недозаполненные (≤ 50%),
  // самые пустые сверху. Это «требуют внимания», полный отчёт — по ссылке.
  // Одноразовые технические группы не показываем.
  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null, isActive: true, isOneTime: false },
    select: {
      id: true,
      name: true,
      maxStudents: true,
      branch: { select: { name: true } },
      direction: { select: { name: true } },
      enrollments: { where: { isActive: true, deletedAt: null }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  })

  const groupCapacity = groups
    .map((g) => {
      const enrolled = g.enrollments.length
      const max = g.maxStudents
      return {
        id: g.id,
        name: g.name,
        branch: g.branch.name,
        direction: g.direction.name,
        enrolled,
        max,
        free: Math.max(0, max - enrolled),
        percent: max > 0 ? Math.round((enrolled / max) * 100) : 0,
      }
    })
    .filter((g) => g.percent <= 50)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 10)

  // Ожидаемые поступления средств — финансовый отчёт по филиалам за выбранный месяц.
  // Логика повторяет /api/reports/expected-income: активные/pending абонементы
  // активных клиентов; calendar — фильтр по periodYear/Month, package — пересечение
  // действия пакета с диапазоном месяца.
  const orgInfo = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackageOrg = orgInfo?.subscriptionType === "package"
  const monthEndDt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const expectedSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["active", "pending"] },
      client: { clientStatus: "active" },
      ...(isPackageOrg
        ? {
            type: "package",
            startDate: { lte: monthEndDt },
            OR: [{ expiresAt: null }, { expiresAt: { gte: monthStart } }],
          }
        : { periodYear: year, periodMonth: month }),
    },
    select: {
      finalAmount: true,
      discountAmount: true,
      balance: true,
      group: { select: { branch: { select: { id: true, name: true } } } },
    },
  })

  interface IncomeRow {
    branchId: string
    branch: string
    subAmount: number
    expected: number
    paid: number
    discount: number
  }
  const incomeMap = new Map<string, IncomeRow>()
  for (const s of expectedSubs) {
    const branchId = s.group.branch.id
    let row = incomeMap.get(branchId)
    if (!row) {
      row = {
        branchId,
        branch: s.group.branch.name,
        subAmount: 0,
        expected: 0,
        paid: 0,
        discount: 0,
      }
      incomeMap.set(branchId, row)
    }
    const finalAmt = Number(s.finalAmount)
    const bal = Number(s.balance)
    row.subAmount += finalAmt
    if (bal > 0) row.expected += bal
    row.discount += Number(s.discountAmount)
  }
  for (const r of incomeMap.values()) {
    // paid = subAmount − expected: то, что уже фактически списано в счёт абонементов.
    r.paid = r.subAmount - r.expected
  }
  const incomeRows = [...incomeMap.values()].sort((a, b) =>
    a.branch.localeCompare(b.branch, "ru")
  )
  const incomeTotals = incomeRows.reduce(
    (acc, r) => ({
      subAmount: acc.subAmount + r.subAmount,
      expected: acc.expected + r.expected,
      paid: acc.paid + r.paid,
      discount: acc.discount + r.discount,
    }),
    { subAmount: 0, expected: 0, paid: 0, discount: 0 }
  )
  const incomePct = (part: number, total: number) =>
    total > 0 ? Math.round((part / total) * 100) : 0
  const fmtIncome = (n: number) =>
    n > 0 ? new Intl.NumberFormat("ru-RU").format(Math.round(n)) : "—"

  // === ПРОГНОЗ ПРИБЫЛИ (reports-logic §7.1, упрощённый под дашборд) ===
  // Прибыль = Сумма абонементов − Прогноз ЗП педагогов − Прогноз постоянных
  // платежей. «Сумма абонементов» — тот же subAmount, что в виджете
  // «Ожидаемые поступления». ЗП — оклад или ставка×занятия (см. helper).
  // Постоянные платежи — плановые расходы постоянных категорий за месяц
  // (PlannedExpense, isVariable=false), «заполняется вручную раз в месяц».
  // Переменные расходы в виджет не входят (на макете их нет).
  const profitSubAmount = incomeTotals.subAmount

  const [salaryForecast, plannedFixed] = await Promise.all([
    computeMonthlySalaryForecast(db, tenantId, year, month),
    db.plannedExpense.findMany({
      where: {
        tenantId,
        periodYear: year,
        periodMonth: month,
        category: { isVariable: false },
      },
      select: { plannedAmount: true },
    }),
  ])
  const fixedPaymentsForecast = plannedFixed.reduce(
    (s, p) => s + Number(p.plannedAmount),
    0
  )
  const profitForecast = profitSubAmount - salaryForecast - fixedPaymentsForecast

  const monthStartLabel = monthStart.toLocaleDateString("ru-RU", { month: "long" })
  const profitMonthLabel =
    monthStartLabel.charAt(0).toUpperCase() +
    monthStartLabel.slice(1) +
    " " +
    String(year).slice(2)

  // === АКТИВНЫЕ АБОНЕМЕНТЫ (по филиалам, за месяц) ===
  const activeSubsData = await computeActiveSubscriptionsByBranch(db, tenantId, year, month)
  const fmtCount = (n: number) => (n > 0 ? String(n) : "—")

  // === ОСТАТКИ ДЕНЕГ (по счетам/кассам) ===
  // Текущие остатки активных счетов — снимок «сейчас», не зависит от месяца.
  const cashAccounts = await db.financialAccount.findMany({
    where: { tenantId, isActive: true, deletedAt: null },
    select: { id: true, name: true, balance: true },
    orderBy: { name: "asc" },
  })
  const cashTotal = cashAccounts.reduce((s, a) => s + Number(a.balance), 0)
  const fmtMoney2 = (n: number) =>
    new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // === НЕ ПРИШЛИ НА ПРОБНИК (пробные за месяц со статусом «Неявка») ===
  // Только no_show — ребёнок не пришёл на назначенное пробное.
  const missedTrialsRaw = await db.trialLesson.findMany({
    where: {
      tenantId,
      scheduledDate: { gte: monthStart, lte: monthEnd },
      status: "no_show",
      client: { deletedAt: null },
    },
    select: {
      id: true,
      scheduledDate: true,
      startTime: true,
      ward: { select: { firstName: true, lastName: true } },
      client: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: {
        select: {
          direction: { select: { name: true } },
          branch: { select: { name: true } },
        },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  })
  const missedTrials = missedTrialsRaw.map((t) => {
    const d = t.scheduledDate
    const dd = String(d.getUTCDate()).padStart(2, "0")
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    const yy = String(d.getUTCFullYear()).slice(2)
    // Лид — имя ребёнка (подопечного); если по какой-то причине пробное без
    // ребёнка — показываем родителя.
    const childName = t.ward
      ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ")
      : ""
    const parentName = [t.client.lastName, t.client.firstName].filter(Boolean).join(" ")
    return {
      id: t.id,
      date: `${dd}.${mm}.${yy}${t.startTime ? " " + t.startTime : ""}`,
      lead: childName || parentName || "—",
      dayType: "Неявка",
      branch: t.group?.branch?.name ?? "—",
      direction: t.direction?.name ?? t.group?.direction?.name ?? "—",
    }
  })

  // === ДНИ РОЖДЕНИЯ (дети с активным абонементом + сотрудники, окно 30 дней) ===
  // Отсчёт от реального «сегодня», не зависит от выбранного месяца.
  const realToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const birthdaysData = await computeUpcomingBirthdays(db, tenantId, realToday)
  const birthdaysCount = birthdaysData.children.length + birthdaysData.staff.length

  // === ОТРАБОТАННЫЕ АБОНЕМЕНТЫ (по филиалам, за месяц) — reports-logic §5.10 ===
  // Сумма абонементов = SUM(finalAmount) всех выписанных за период; Отработано
  // = SUM(chargedAmount) — накопленные списания с абонемента (доход в финрезе).
  const workedSubsRaw = await db.subscription.findMany({
    where: { tenantId, deletedAt: null, periodYear: year, periodMonth: month },
    select: {
      finalAmount: true,
      chargedAmount: true,
      group: { select: { branch: { select: { id: true, name: true } } } },
    },
  })
  interface WorkedRow { branchId: string; branch: string; subAmount: number; worked: number }
  const workedMap = new Map<string, WorkedRow>()
  for (const s of workedSubsRaw) {
    const b = s.group.branch
    let row = workedMap.get(b.id)
    if (!row) {
      row = { branchId: b.id, branch: b.name, subAmount: 0, worked: 0 }
      workedMap.set(b.id, row)
    }
    row.subAmount += Number(s.finalAmount)
    row.worked += Number(s.chargedAmount)
  }
  const workedRows = [...workedMap.values()].sort((a, b) => a.branch.localeCompare(b.branch, "ru"))
  const workedTotals = workedRows.reduce(
    (acc, r) => ({ subAmount: acc.subAmount + r.subAmount, worked: acc.worked + r.worked }),
    { subAmount: 0, worked: 0 }
  )
  const fmtRub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n))

  const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "long" })

  const stats = [
    { title: "Активные абонементы", value: String(activeSubscriptions), icon: Users, color: "text-green-600", bg: "bg-green-50", href: "/crm/contacts?tab=active" },
    { title: "Доходы", value: formatMoney(monthIncome), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50", href: "/finance/dds?kind=income" },
    { title: "Расходы за месяц", value: formatMoney(monthExpenses), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50", href: "/finance/expenses" },
    { title: "Должники", value: `${debtorCount} / ${formatMoney(totalDebt)}`, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50", href: "/finance/debtors" },
  ]

  // === Виджеты как именованные блоки для DashboardGrid ===

  const statsWidget = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Link key={stat.title} href={stat.href}>
          <Card className="transition-colors hover:bg-muted/50">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${stat.bg}`}>
                <stat.icon className={`size-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.title}</p>
                <p className="text-lg font-bold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )

  const tasksWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Link href="/tasks" className="hover:underline">Задачи на сегодня</Link>
          <Badge variant="secondary">{todayTaskRows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DashboardTasksTable tasks={todayTaskRows} />
      </CardContent>
    </Card>
  )

  const unmarkedWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Link href="/schedule" className="hover:underline">Неотмеченные занятия</Link>
          <Badge variant={unmarkedLessons.length > 0 ? "destructive" : "secondary"}>{unmarkedLessons.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {unmarkedLessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Все занятия отмечены</p>
        ) : (
          unmarkedLessons.map((lesson) => (
            <Link key={lesson.id} href={`/schedule/lessons/${lesson.id}`}
              className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted/50">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span className="font-medium">{lesson.startTime}</span>
                <span>{lesson.group.name}</span>
              </div>
              <span className="text-muted-foreground">
                {lesson.date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
              </span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  )

  const funnelWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/reports/crm/funnel" className="hover:underline">Воронка продаж</Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          За месяц, включая перетекающие заявки — детали в отчёте
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {funnelStages.map((stage) => (
          <div key={stage.stage} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{stage.stage}</span>
              <span className="font-bold">{stage.count}</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className={`h-2 rounded-full ${stage.color}`}
                style={{ width: `${Math.max((stage.count / maxFunnel) * 100, stage.count > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )

  const expectedIncomeWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/finance/debtors" className="hover:underline">
            Ожидаемые поступления средств
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {incomeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет абонементов за выбранный месяц
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead className="text-right">Сумма абонементов</TableHead>
                <TableHead className="text-right">Ожидаемые поступления</TableHead>
                <TableHead className="text-right">Оплачено</TableHead>
                <TableHead className="text-right">% долга</TableHead>
                <TableHead className="text-right">Сумма скидок</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incomeRows.map((r) => (
                <TableRow key={r.branchId}>
                  <TableCell>{r.branch}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtIncome(r.subAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtIncome(r.expected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtIncome(r.paid)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.expected > 0 ? `${incomePct(r.expected, r.subAmount)} %` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtIncome(r.discount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(incomeTotals.subAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(incomeTotals.expected)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(incomeTotals.paid)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {incomeTotals.expected > 0
                    ? `${incomePct(incomeTotals.expected, incomeTotals.subAmount)} %`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(incomeTotals.discount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const missedTrialsWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Link href="/crm/sales" className="hover:underline">
            Не пришли на пробник
          </Link>
          <Badge variant={missedTrials.length > 0 ? "destructive" : "secondary"}>
            {missedTrials.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {missedTrials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет пропущенных пробных в этом месяце</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата пробника</TableHead>
                <TableHead>Лид</TableHead>
                <TableHead>Тип дня</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Направление</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missedTrials.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="tabular-nums">{t.date}</TableCell>
                  <TableCell>{t.lead}</TableCell>
                  <TableCell>{t.dayType}</TableCell>
                  <TableCell>{t.branch}</TableCell>
                  <TableCell>{t.direction}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const birthdaysWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Cake className="size-5 text-muted-foreground" />
            Дни рождения
          </span>
          <Badge variant="secondary">{birthdaysCount}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {birthdaysCount === 0 ? (
          <p className="text-sm text-muted-foreground">Нет дней рождения в ближайшие 30 дней</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО</TableHead>
                <TableHead>Дата ДР</TableHead>
                <TableHead>Сколько исполнится</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {birthdaysData.children.length > 0 && (
                <>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={3} className="font-semibold">Дети</TableCell>
                  </TableRow>
                  {birthdaysData.children.map((r) => (
                    <TableRow key={`c-${r.id}`}>
                      <TableCell>{r.fio}</TableCell>
                      <TableCell className="tabular-nums">{r.dateLabel}</TableCell>
                      <TableCell>{r.turnsLabel}</TableCell>
                    </TableRow>
                  ))}
                </>
              )}
              {birthdaysData.staff.length > 0 && (
                <>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={3} className="font-semibold">Сотрудники</TableCell>
                  </TableRow>
                  {birthdaysData.staff.map((r) => (
                    <TableRow key={`s-${r.id}`}>
                      <TableCell>{r.fio}</TableCell>
                      <TableCell className="tabular-nums">{r.dateLabel}</TableCell>
                      <TableCell>{r.turnsLabel}</TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const workedSubsWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/reports/finance/revenue" className="hover:underline">
            Отработанные абонементы
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {workedRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет абонементов за выбранный месяц</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead className="text-right">Сумма абонементов</TableHead>
                <TableHead className="text-right">Отработано</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workedRows.map((r) => (
                <TableRow key={r.branchId}>
                  <TableCell>{r.branch}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtRub(r.subAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtRub(r.worked)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right tabular-nums">{fmtRub(workedTotals.subAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtRub(workedTotals.worked)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const cashBalancesWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/finance/cash" className="hover:underline">
            Остатки денег
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {cashAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет счетов</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Банковский счёт, касса</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashAccounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney2(Number(a.balance))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney2(cashTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const activeSubsWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/reports/crm/active-subs-dynamics" className="hover:underline">
            Активные абонементы
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activeSubsData.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет активированных абонементов за выбранный месяц
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead className="text-right">Количество абонементов за месяц</TableHead>
                <TableHead className="text-right">Продленные абонементы</TableHead>
                <TableHead className="text-right">Количество активных на конец месяца</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeSubsData.rows.map((r) => (
                <TableRow key={r.branchId}>
                  <TableCell>{r.branch}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(r.created)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(r.renewed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(r.activeNow)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell>Итого</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCount(activeSubsData.totals.created)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCount(activeSubsData.totals.renewed)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCount(activeSubsData.totals.activeNow)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const profitForecastWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/reports/finance/pnl" className="hover:underline">
            Прогноз прибыли
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {profitSubAmount === 0 && salaryForecast === 0 && fixedPaymentsForecast === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет данных по прогнозу за выбранный месяц
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Месяц</TableHead>
                <TableHead className="text-right">Сумма абонементов</TableHead>
                <TableHead className="text-right">Прогноз зарплаты педагогов</TableHead>
                <TableHead className="text-right">Прогноз постоянных платежей</TableHead>
                <TableHead className="text-right">Прогноз прибыли</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">{profitMonthLabel}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(profitSubAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(salaryForecast)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(fixedPaymentsForecast)}</TableCell>
                <TableCell
                  className={`text-right font-semibold tabular-nums ${
                    profitForecast < 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {new Intl.NumberFormat("ru-RU").format(Math.round(profitForecast))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  const capacityWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <BarChart3 className="size-5 text-muted-foreground" />
            <Link href="/reports/schedule/capacity" className="hover:underline">
              Заполняемость групп
            </Link>
          </span>
          <Badge variant="secondary">{groupCapacity.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groupCapacity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет групп с заполнением 50% и ниже
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Группа обучения</TableHead>
                <TableHead className="text-right">Свободно мест</TableHead>
                <TableHead className="text-right">% заполнения</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupCapacity.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{g.branch}</TableCell>
                  <TableCell>{g.direction}</TableCell>
                  <TableCell>{g.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.free}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.percent} %</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  return (
    // pb-24 — нижний отступ, чтобы плавающая иконка AI-агента не перекрывала
    // данные последних виджетов при прокрутке до конца.
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Дашборд</h1>
          <PageHelp pageKey="dashboard" />
          <MonthPicker />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{dateStr}</span>
          <DashboardSettingsButton />
        </div>
      </div>

      <DashboardGrid
        widgets={{
          stats: statsWidget,
          tasks: tasksWidget,
          expectedIncome: expectedIncomeWidget,
          activeSubs: activeSubsWidget,
          profitForecast: profitForecastWidget,
          missedTrials: missedTrialsWidget,
          unmarked: unmarkedWidget,
          funnel: funnelWidget,
          capacity: capacityWidget,
          cashBalances: cashBalancesWidget,
          birthdays: birthdaysWidget,
          workedSubs: workedSubsWidget,
        }}
      />
    </div>
  )
}
