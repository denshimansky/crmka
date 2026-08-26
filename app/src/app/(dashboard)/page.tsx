import type { ReactNode } from "react"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { hasPermission, type PermissionKey, type RolePermissions } from "@/lib/permissions"
import { getOrgUiSettings } from "@/lib/role-names"
import { formatMoney as fmtMoney, currencySymbol } from "@/lib/currency"
import { CurrencyPrompt } from "@/components/currency-prompt"
import { DASHBOARD_WIDGET_GATES, STAT_CARD_PERMISSIONS } from "@/lib/dashboard/widget-permissions"
import { taskVisibilityWhere } from "@/lib/tasks/task-visibility"
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
import { sumPaidTrialRevenue } from "@/lib/finance/paid-trial-revenue"
import { computeActiveSubscriptionsByBranch } from "@/lib/dashboard/active-subscriptions"
import { computeUpcomingBirthdays } from "@/lib/dashboard/upcoming-birthdays"
import { computePlannedExpensesWithFact } from "@/lib/finance/planned-expenses"
import { computeSalesFunnel, summarizeSalesFunnel } from "@/lib/reports/sales-funnel"
import { computeMonthSubscriptionFigures } from "@/lib/finance/subscription-month-figures"
import { lessonsWithRoster } from "@/lib/subscriptions/roster-filter"
import {
  scopeFinancialAccount,
  scopeLesson,
  scopeTrialLesson,
  scopeGroup,
  scopeSubscription,
  scopeExpense,
  scopePaymentByAccount,
} from "@/lib/branch-scope"

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

  // Инструктору (инструктору) дашборд с виджетами не показываем — это управленческая
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

  // Права роли — тем же способом, что и гард маршрутов в layout.tsx: каждый
  // виджет ведёт на отчёт/раздел, и мы показываем его только если у роли есть
  // доступ к этому разделу (то же право, что гейтит саму страницу). Иначе
  // виджет (и отдельные карточки-метрики) не отображаем. getOrgUiSettings
  // обёрнут в React cache — повторного запроса к БД после layout не будет.
  const orgUi = await getOrgUiSettings(tenantId)
  let orgPerms: RolePermissions | null = null
  if (session.user.role !== "owner") {
    orgPerms = (orgUi?.rolePermissions as RolePermissions | null) ?? null
  }
  const can = (perm: PermissionKey) => hasPermission(session.user.role, perm, orgPerms)

  // ADM-04: филиальный scope сессии. Для владельца/управляющего и админа без
  // привязок — mode "all" (все хелперы scope* становятся no-op). Для админа с
  // привязкой к филиалу(-ам) — ограничение по его филиалам. Применяется КО ВСЕМ
  // виджетам ниже, чтобы скоуп-админ не видел задачи/занятия/пробники/абонементы
  // чужих филиалов.
  // ВАЖНО: getBranchScope (async), а НЕ branchScopeFromSession — только он
  // считает coversAllBranches (админ отметил ВСЕ живые филиалы → видит клиентов
  // и задачи о них без проставленного филиала, решение 13.08.2026). С sync-
  // версией виджет «Задачи на сегодня» терял безфилиальных клиентов у такого
  // админа (видел 1 из 12 вместо всех).
  const scope = await getBranchScope()

  // Валюта расчёта организации (отображение символа/формата). Локальный
  // formatMoney теперь форматирует в валюте организации.
  const currency = orgUi?.currency ?? "RUB"
  const currencyChosen = orgUi?.currencyChosen ?? true
  const formatMoney = (amount: number) => fmtMoney(amount, currency)
  // Новой организации (валюта ещё не выбрана) показываем разовый запрос валюты —
  // только владельцу/управляющему, которые могут её сохранить.
  const showCurrencyPrompt =
    !currencyChosen && (session.user.role === "owner" || session.user.role === "manager")

  // Заголовок отчётного виджета: если у роли есть доступ к отчёту — ссылка,
  // иначе просто текст (виджет с данными показываем, но перехода в отчёт нет).
  const reportTitle = (linkPerm: PermissionKey, href: string, text: string) =>
    can(linkPerm) ? (
      <Link href={href} className="hover:underline">{text}</Link>
    ) : (
      <span>{text}</span>
    )

  const { year, month } = getMonthFromParams(await searchParams)
  const now = new Date()
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))
  // realToday — РЕАЛЬНОЕ «сегодня», НЕ зависит от селектора месяца. Все
  // date-relative виджеты (задачи, ДР, неотмеченные занятия) считают от него.
  // Иначе при листании на другой месяц «сегодня» уезжало (месяц селектора +
  // текущее число): задачи краснели «просроченными», будущие подтягивались как
  // сегодняшние. Финансовые виджеты ниже — по выбранному месяцу (monthStart/monthEnd).
  const realToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // === МЕТРИКИ ===

  // Активные ученики (уникальные клиенты с активными абонементами)
  const activeSubscriptions = await db.subscription.count({
    where: { tenantId, deletedAt: null, status: "active", ...scopeSubscription(scope) },
  })

  // Доходы за месяц — приходы из ДДС (фактически полученные деньги).
  // Не путаем с выручкой ОПИУ (отработанные занятия). На дашборде показываем
  // именно деньги в кассу/на счёт. refund и transfer_in не считаем — это не
  // «новые деньги», а возврат/внутреннее перемещение.
  // ADM-04: доход по видимым счетам (scopePaymentByAccount) — скоуп-админ не
  // считает движения по счетам чужих/общих филиалов. Карточка «Доходы» и так
  // скрыта у админа (finance.result), scope здесь — защита на случай выдачи прав.
  const monthIncomeData = await db.payment.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
      type: "incoming",
      ...scopePaymentByAccount(scope),
    },
    _sum: { amount: true },
  })
  const monthIncome = Number(monthIncomeData._sum.amount || 0)

  // Расходы за месяц (ADM-04: только расходы видимых филиалов)
  const monthExpensesData = await db.expense.aggregate({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd }, ...scopeExpense(scope) },
    _sum: { amount: true },
  })
  const monthExpenses = Number(monthExpensesData._sum.amount || 0)

  // Должники за выбранный месяц (debtorCount / totalDebt) считаются ниже из того
  // же единого набора абонементов (subFigures), что и виджет «Ожидаемые
  // поступления средств» — чтобы карточка «Должники» совпадала с ним по сумме.

  // Задачи на сегодня (и просроченные). Для менеджера/владельца — все задачи
  // тенанта; админ с привязкой к филиалу — только задачи своих филиалов (по
  // клиенту/исполнителю/назначенные лично, ADM-04); инструктор/readonly — только
  // свои. Единое правило видимости — lib/tasks/task-visibility.ts.
  const TASKS_WIDGET_LIMIT = 15
  const todayTasksWhere = {
    tenantId,
    deletedAt: null,
    status: "pending" as const,
    dueDate: { lte: realToday },
    ...taskVisibilityWhere(session.user.role, session.user.employeeId ?? null, scope),
  }
  // Счётчик на плашке — РЕАЛЬНОЕ число задач «сегодня + просрочено» (отдельный
  // count), а не длина показанного списка: список ограничен TASKS_WIDGET_LIMIT
  // строками, и раньше badge = todayTasks.length упирался в лимит (при 16 задачах
  // показывал 15). Строк по-прежнему максимум TASKS_WIDGET_LIMIT — счётчик может
  // быть больше (напр. «15 строк, 23 в счётчике»).
  const [todayTasks, todayTasksCount] = await Promise.all([
    db.task.findMany({
      where: todayTasksWhere,
      select: {
        id: true,
        title: true,
        dueDate: true,
        createdAt: true,
        clientId: true,
        client: { select: { firstName: true, lastName: true } },
      },
      // Сортируем по сроку (старые сверху): при take виджет удерживает
      // СТАРЕЙШИЕ просроченные, а не свежесозданные. На базе с большим бэклогом
      // (напр. 200 просроченных) виджет показывает именно долги — «сначала
      // просроченные, от старых к новым» (решение 12.08.2026). Компромисс принят
      // осознанно: пока просроченных ≥ лимита, сегодняшние и только что созданные
      // задачи в виджет не попадают — их место в полном списке /tasks (вкладки
      // «Актуальные»/«Просроченные»). Вторичный ключ createdAt asc — детерминизм
      // среди задач одной даты. Порядок отображения (просроченные сверху)
      // дублирует DashboardTasksTable.
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: TASKS_WIDGET_LIMIT,
    }),
    db.task.count({ where: todayTasksWhere }),
  ])

  // Слева в виджете показываем ДАТУ ПОЯВЛЕНИЯ задачи (dueDate = день генерации),
  // а не дату события. Тогда показанная дата совпадает с логикой «красная/
  // просрочена» (просрочено = dueDate < сегодня): «Не был» вчера, но задача
  // появилась сегодня — слева стоит сегодня; не закрыл — завтра та же дата
  // становится красной. Дату события (пробное / занятие «Не был») оставляем
  // в заголовке, нормализуя `(YYYY-MM-DD)` и `(DD.MM.YYYY)` к краткой `(DD.MM)`.
  const todayIso = realToday.toISOString().slice(0, 10)
  const todayTaskRows: DashboardTaskRow[] = todayTasks.map((t) => {
    const dueIso = t.dueDate.toISOString().slice(0, 10)
    return {
      id: t.id,
      title: t.title
        .replace(/\((\d{4})-(\d{2})-(\d{2})\)/, (_m, _y, mo, d) => `(${d}.${mo})`)
        .replace(/\((\d{2})\.(\d{2})\.\d{4}\)/, (_m, d, mo) => `(${d}.${mo})`)
        .trim(),
      dueDate: dueIso,
      isOverdue: dueIso < todayIso,
      createdAt: t.createdAt.toISOString(),
      clientId: t.clientId,
      clientName: t.client
        ? [t.client.lastName, t.client.firstName].filter(Boolean).join(" ")
        : null,
    }
  })

  // Неотмеченные занятия — операционный виджет «вы забыли отметить», НЕ зависит
  // от селектора месяца: считаем от реального «сегодня» (realToday), а не от
  // month-today. Иначе на прошлом месяце окно [1-е..month-today] теряло конец
  // месяца, а нижняя граница цеплялась за 1-е число выбранного месяца. Окно —
  // скользящие ~60 дней назад (ловит и конец прошлого месяца через границу).
  // Верхняя граница ≤ realToday обязательна: иначе будущие занятия из расписания
  // заняли бы топ-60 по date desc и все отсеялись бы фильтром «уже закончилось».
  // Сегодняшние занятия, у которых endTime ещё не наступил, отсекаем в JS —
  // postgres не умеет элегантно сравнить time-of-day + duration без raw SQL.
  const unmarkedFrom = new Date(realToday)
  unmarkedFrom.setUTCDate(unmarkedFrom.getUTCDate() - 60)
  const unmarkedRaw = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: unmarkedFrom, lte: realToday },
      status: "scheduled",
      // isPending-плейсхолдер разового ученика — не отметка
      attendances: { none: { isPending: false } },
      // ADM-04: только занятия групп видимых филиалов.
      ...scopeLesson(scope),
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      durationMinutes: true,
      rescheduledFromDate: true,
      groupId: true,
      group: { select: { name: true, directionId: true } },
    },
    orderBy: { date: "desc" },
    // С запасом: пустые занятия (в группе в тот день никого) ниже отсекаются,
    // поэтому кандидатов берём больше пятёрки, что реально показываем.
    take: 60,
  })
  const nowMs = Date.now()
  const endedUnmarked = unmarkedRaw.filter((l) => {
    const [hh, mm] = l.startTime.split(":").map(Number)
    // date — DATE без TZ, считаем как локальную дату.
    const start = new Date(l.date)
    start.setHours(hh || 0, mm || 0, 0, 0)
    const end = start.getTime() + (l.durationMinutes || 60) * 60_000
    return end <= nowMs
  })
  // Гейт состава (баг #114): занятие «неотмеченное», только если на его дату
  // есть кого отмечать — хотя бы один зачисленный ребёнок с покрывающим
  // абонементом (как в отчёте «Неотмеченные» и карточке занятия). Пустые
  // занятия (все выбыли / никто не зачислён / нет покрытия) в виджет не попадают.
  const rosterIds = await lessonsWithRoster(
    db,
    tenantId,
    endedUnmarked.map((l) => ({
      id: l.id,
      date: l.date,
      rescheduledFromDate: l.rescheduledFromDate,
      groupId: l.groupId,
      directionId: l.group.directionId,
    })),
  )
  const unmarkedLessons = endedUnmarked.filter((l) => rosterIds.has(l.id)).slice(0, 5)

  // Воронка продаж (CRM-13) — событийная воронка по заявкам за месяц, каждый этап
  // одной суммарной цифрой (текущий месяц + перетекающие). ADM-04: scope сессии.
  // onlyNew: на дашборде показываем воронку ТОЛЬКО по новым лидам (вкладка «Лиды»
  // отчёта), без действующей базы (допродажи/продления). В самом отчёте сводная
  // строка складывает обе вкладки (Лиды + База) — там это осознанно.
  const funnelMonth = summarizeSalesFunnel(
    await computeSalesFunnel(tenantId, year, month, {
      withRows: false,
      scope,
    }),
    { onlyNew: true },
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
    where: { tenantId, deletedAt: null, isActive: true, isOneTime: false, ...scopeGroup(scope) },
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

  // Единая «Сумма абонементов» месяца для трёх карточек (Ожидаемые/Отработанные/
  // Прогноз) и карточки «Должники»: ОДИН набор абонементов месяца — любого статуса
  // и клиента, включая воронку — считается одинаково (спека Ани 09.08.2026,
  // см. lib/finance/subscription-month-figures.ts). ADM-04: scope сессии.
  const orgInfo = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackageOrg = orgInfo?.subscriptionType === "package"

  const subFigures = await computeMonthSubscriptionFigures(db, {
    tenantId, year, month, scope, isPackageOrg,
  })

  // Ожидаемые поступления средств — по филиалам за выбранный месяц.
  interface IncomeRow {
    branchId: string
    branch: string
    subAmount: number
    expected: number
    paid: number
    discount: number
  }
  const incomeMap = new Map<string, IncomeRow>()
  for (const s of subFigures) {
    const branchId = s.branchId ?? "__none__"
    let row = incomeMap.get(branchId)
    if (!row) {
      row = {
        branchId,
        branch: s.branchName ?? "Без филиала",
        subAmount: 0,
        expected: 0,
        paid: 0,
        discount: 0,
      }
      incomeMap.set(branchId, row)
    }
    row.subAmount += s.subAmount
    row.expected += s.expected
    row.discount += s.discount
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

  // Должники за выбранный месяц: клиенты с долгом (expected>0) в едином наборе
  // абонементов месяца. totalDebt по построению равен «Ожидаемым поступлениям»
  // (incomeTotals.expected), поэтому карточка «Должники» совпадает с виджетом.
  const monthDebtorIds = new Set<string>()
  for (const s of subFigures) {
    if (s.expected > 0) monthDebtorIds.add(s.clientId)
  }
  const debtorCount = monthDebtorIds.size
  const totalDebt = incomeTotals.expected

  const incomePct = (part: number, total: number) =>
    total > 0 ? Math.round((part / total) * 100) : 0
  const fmtIncome = (n: number) =>
    n > 0 ? new Intl.NumberFormat("ru-RU").format(Math.round(n)) : "—"

  // === ПРОГНОЗ ПРИБЫЛИ (reports-logic §7.1, упрощённый под дашборд) ===
  // Прибыль = Сумма абонементов − Прогноз ЗП инструкторов − Переменные расходы
  // − Прогноз постоянных платежей. «Сумма абонементов» — та же ЕДИНАЯ сумма, что
  // в «Ожидаемых» и «Отработанных» (спека Ани 09.08.2026: во всех трёх карточках
  // одинаковая — один набор абонементов месяца, включая воронку). ЗП — оклад или
  // ставка×занятия (helper). Переменные расходы — среднемесячный ФАКТ переменных
  // расходов за 3 месяца (Expense.isVariable, БЕЗ ЗП-категорий), как в §7.1.
  // Постоянные платежи — плановые расходы постоянных категорий (PlannedExpense,
  // isVariable=false), «заполняется вручную раз в месяц».
  const paidTrialRevenue = await sumPaidTrialRevenue(db, { tenantId, year, month, scope })
  const profitSubAmount = subFigures.reduce((s, f) => s + f.subAmount, 0) + paidTrialRevenue

  // ADM-04: profitSubAmount уже заскоуплен (через subFigures), но прогноз ЗП и
  // плановые расходы ниже остаются общеорганизационными. Виджеты «Прогноз
  // прибыли»/«Плановые расходы» скрыты у скоуп-админа (reports.finance/
  // finance.result), поэтому протечки нет. Если такие права выдадут админу —
  // отдельно заскоупить salary/planned по филиалам (семантика «общих» статей
  // без филиала требует продуктового решения).
  // Переменные расходы прогноза — среднемесячный ФАКТ за последние 3 месяца (как в
  // отчёте §7.1, api/reports/profit-forecast): плановые переменные расходы почти
  // никогда не заполняются, поэтому раньше столбец был всегда «—». ЗП-категории
  // исключаем (category.isSalary=false) — ЗП инструкторов уже отдельным столбцом
  // (из расписания), иначе задвоение. not_in_pnl в прогноз не идёт.
  const variableExpFrom = new Date(Date.UTC(year, month - 4, 1)) // начало 3-го месяца до отчётного
  const [salaryForecast, plannedFixed, prevVariableExpenses] = await Promise.all([
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
    db.expense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isVariable: true,
        category: { isSalary: false },
        date: { gte: variableExpFrom, lt: monthStart },
        recognitionMode: { not: "not_in_pnl" },
      },
      select: { amount: true, date: true },
    }),
  ])
  const fixedPaymentsForecast = plannedFixed.reduce(
    (s, p) => s + Number(p.plannedAmount),
    0
  )
  // Среднее по месяцам, в которых были переменные расходы (до 3): сумма ÷ число
  // таких месяцев — прогноз занижался бы, делись мы всегда на 3 при неполных данных.
  const variableMonthBuckets = new Map<string, number>()
  for (const e of prevVariableExpenses) {
    const key = `${e.date.getUTCFullYear()}-${e.date.getUTCMonth()}`
    variableMonthBuckets.set(key, (variableMonthBuckets.get(key) ?? 0) + Number(e.amount))
  }
  const variableExpensesForecast =
    variableMonthBuckets.size > 0
      ? [...variableMonthBuckets.values()].reduce((s, v) => s + v, 0) / variableMonthBuckets.size
      : 0
  const profitForecast =
    profitSubAmount - salaryForecast - variableExpensesForecast - fixedPaymentsForecast

  const monthStartLabel = monthStart.toLocaleDateString("ru-RU", { month: "long" })
  const profitMonthLabel =
    monthStartLabel.charAt(0).toUpperCase() +
    monthStartLabel.slice(1) +
    " " +
    String(year).slice(2)

  // === АКТИВНЫЕ АБОНЕМЕНТЫ (по филиалам, за месяц) ===
  const activeSubsData = await computeActiveSubscriptionsByBranch(db, tenantId, year, month, scope)
  const fmtCount = (n: number) => (n > 0 ? String(n) : "—")

  // === ОСТАТКИ ДЕНЕГ (по счетам/кассам) ===
  // Текущие остатки активных счетов — снимок «сейчас», не зависит от месяца.
  // ADM-04 (23.07.2026): скоуп-админ видит только счета своих филиалов; общие
  // счета (branchId=NULL) — общеорганизационная информация, на дашборде скрыты.
  const cashAccounts = await db.financialAccount.findMany({
    where: {
      tenantId,
      isActive: true,
      deletedAt: null,
      ...scopeFinancialAccount(scope),
    },
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
      // ADM-04: пробные видимых филиалов (по группе/кабинету пробного).
      ...scopeTrialLesson(scope),
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
  // Отсчёт от реального «сегодня» (realToday объявлен выше), не зависит от месяца.
  const birthdaysData = await computeUpcomingBirthdays(db, tenantId, realToday, scope)
  const birthdaysCount = birthdaysData.children.length + birthdaysData.staff.length

  // === ОТРАБОТАННЫЕ АБОНЕМЕНТЫ (по филиалам, за месяц) — reports-logic §5.10 ===
  // Тот же ЕДИНЫЙ набор, что «Ожидаемые»/«Прогноз» (одинаковая «Сумма абонементов»,
  // спека Ани). Отработано = SUM(chargedAmount) — списания за проведённые занятия.
  interface WorkedRow { branchId: string; branch: string; subAmount: number; worked: number }
  const workedMap = new Map<string, WorkedRow>()
  for (const s of subFigures) {
    const branchId = s.branchId ?? "__none__"
    let row = workedMap.get(branchId)
    if (!row) {
      row = { branchId, branch: s.branchName ?? "Без филиала", subAmount: 0, worked: 0 }
      workedMap.set(branchId, row)
    }
    row.subAmount += s.subAmount
    row.worked += s.worked
  }
  const workedRows = [...workedMap.values()].sort((a, b) => a.branch.localeCompare(b.branch, "ru"))
  const workedTotals = workedRows.reduce(
    (acc, r) => ({ subAmount: acc.subAmount + r.subAmount, worked: acc.worked + r.worked }),
    { subAmount: 0, worked: 0 }
  )
  const fmtRub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n))

  // === ПЛАНОВЫЕ РАСХОДЫ (план vs факт по статьям за месяц) ===
  // Тот же расчёт, что и на странице /finance/planned-expenses (общий helper):
  // план — PlannedExpense за месяц, факт — сумма Expense той же категории/филиала.
  const plannedExpenses = await computePlannedExpensesWithFact(db, { tenantId, year, month })
  const plannedTotalPlanned = plannedExpenses.reduce((s, i) => s + i.plannedAmount, 0)
  // Деньги в виджете — как на странице: без округления, с символом валюты.
  const fmtPlanMoney = (n: number) => new Intl.NumberFormat("ru-RU").format(n) + " " + currencySymbol(currency)

  const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "long" })

  // Карточки-метрики фильтруются поштучно по праву связанного раздела
  // (STAT_CARD_PERMISSIONS = те же ключи, что гейтят страницу по ссылке):
  // «Доходы» → /finance/dds (finance.result), у админа по умолчанию закрыт.
  const stats = [
    { title: "Активные абонементы", value: String(activeSubscriptions), icon: Users, color: "text-green-600", bg: "bg-green-50", href: "/crm/subscriptions", perm: STAT_CARD_PERMISSIONS.activeSubscriptions },
    { title: "Доходы", value: formatMoney(monthIncome), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50", href: "/finance/dds?kind=income", perm: STAT_CARD_PERMISSIONS.income },
    { title: "Расходы за месяц", value: formatMoney(monthExpenses), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50", href: "/finance/expenses", perm: STAT_CARD_PERMISSIONS.expenses },
    { title: "Должники", value: `${debtorCount} / ${formatMoney(totalDebt)}`, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50", href: "/finance/debtors", perm: STAT_CARD_PERMISSIONS.debtors },
  ].filter((s) => can(s.perm))

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
          <Badge variant="secondary">{todayTasksCount}</Badge>
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
          {reportTitle("reports.marketing", "/reports/crm/funnel", "Воронка продаж")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Только новые лиды (вкладка «Лиды») за месяц, включая перетекающие
          заявки. Действующая база — в отчёте
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
          <Link href={`/reports/finance/expected-income?year=${year}&month=${month}`} className="hover:underline">
            Ожидаемые поступления средств
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          «Сумма абонементов» — все абонементы месяца (одинаковая в «Ожидаемых»
          и «Отработанных»; в «Прогнозе» к ней добавляется выручка платных
          пробных). «Ожидается» — остаток к оплате (долг). Закрытые/выбывшие
          учтены по факту отработанного.
        </p>
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
                <TableHead className="text-right whitespace-normal">Сумма<br />абонементов</TableHead>
                <TableHead className="text-right whitespace-normal">Ожидаемые<br />поступления</TableHead>
                <TableHead className="text-right">Оплачено</TableHead>
                <TableHead className="text-right">% долга</TableHead>
                <TableHead className="text-right whitespace-normal">Сумма<br />скидок</TableHead>
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
          {reportTitle("reports.finance", "/reports/finance/revenue", "Отработанные абонементы")}
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
          {reportTitle("reports.marketing", "/reports/crm/active-subs-dynamics", "Активные абонементы")}
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
                <TableHead className="text-right whitespace-normal">Количество абонементов<br />за месяц</TableHead>
                <TableHead className="text-right whitespace-normal">Продлённые<br />абонементы</TableHead>
                <TableHead className="text-right whitespace-normal">Количество активных<br />на конец месяца</TableHead>
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
        <p className="text-xs text-muted-foreground mt-1">
          «Сумма абонементов» — все абонементы месяца (та же, что в «Ожидаемых» и
          «Отработанных»). Прибыль = Сумма − прогноз ЗП − переменные − постоянные
          расходы.
        </p>
      </CardHeader>
      <CardContent>
        {profitSubAmount === 0 &&
        salaryForecast === 0 &&
        variableExpensesForecast === 0 &&
        fixedPaymentsForecast === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет данных по прогнозу за выбранный месяц
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Месяц</TableHead>
                <TableHead className="text-right whitespace-normal">Сумма<br />абонементов</TableHead>
                <TableHead className="text-right whitespace-normal">Прогноз зарплаты<br />инструкторов</TableHead>
                <TableHead className="text-right whitespace-normal">Переменные<br />расходы</TableHead>
                <TableHead className="text-right whitespace-normal">Прогноз постоянных<br />платежей</TableHead>
                <TableHead className="text-right whitespace-normal">Прогноз<br />прибыли</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">{profitMonthLabel}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(profitSubAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(salaryForecast)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtIncome(variableExpensesForecast)}</TableCell>
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
            {reportTitle("reports.schedule", "/reports/schedule/capacity", "Заполняемость групп")}
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

  const plannedExpensesWidget = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href="/finance/planned-expenses" className="hover:underline">
            Плановые расходы
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          План по статьям расходов за месяц
        </p>
      </CardHeader>
      <CardContent>
        {plannedExpenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет плановых расходов за выбранный месяц
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Категория</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead className="text-right">План</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plannedExpenses.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.categoryName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.branchName ?? "Общее"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtPlanMoney(item.plannedAmount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[150px] truncate">
                    {item.comment || "—"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell>Итого</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">
                  {fmtPlanMoney(plannedTotalPlanned)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  // Гейтинг виджетов (DASHBOARD_WIDGET_GATES, решение 23.07.2026):
  //  • `show` — право на показ виджета; null → показываем всегда. Отчётные
  //    виджеты (Воронка/Активные абонементы/Заполняемость/Отработанные) показаны
  //    всегда, но их заголовок делинкуется по `link` (см. reportTitle выше).
  //  • Финансовые/отчётные виджеты со `show` (KPI-строка, Ожидаемые поступления,
  //    Прогноз прибыли, Остатки денег, Плановые расходы) у админа (без
  //    finance.result/reports.finance) скрыты; у ролей с доступом — видны.
  const allWidgets: Record<string, ReactNode> = {
    // Если у роли не осталось ни одной доступной карточки — виджет пуст.
    stats: stats.length > 0 ? statsWidget : null,
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
    plannedExpenses: plannedExpensesWidget,
  }

  const widgets: Record<string, ReactNode> = {}
  for (const [id, node] of Object.entries(allWidgets)) {
    if (node == null) continue
    const gate = DASHBOARD_WIDGET_GATES[id]
    if (gate?.show && !can(gate.show)) continue
    widgets[id] = node
  }
  const allowedWidgetIds = Object.keys(widgets)

  return (
    // Нижний отступ под плавающую кнопку AI-ассистента задаётся глобально в
    // layout.tsx (<main> pb-24) — здесь дублировать не нужно.
    <div className="space-y-6">
      {showCurrencyPrompt && <CurrencyPrompt initial={currency} />}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-bold">Дашборд</h1>
          <PageHelp pageKey="dashboard" />
          {/* На дашборде можно смотреть только текущий месяц и один вперёд:
              назад не листаем, вперёд — максимум на 1 месяц. */}
          <MonthPicker disablePast maxMonthsAhead={1} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{dateStr}</span>
          <DashboardSettingsButton allowedWidgetIds={allowedWidgetIds} />
        </div>
      </div>

      <DashboardGrid widgets={widgets} />
    </div>
  )
}
