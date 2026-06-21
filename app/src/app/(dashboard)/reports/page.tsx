import { PageHelp } from "@/components/page-help"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Filter, TrendingDown, Calendar, CreditCard, Wallet } from "lucide-react"
import Link from "next/link"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

type ReportSource =
  | "clients"
  | "payments"
  | "subscriptions"
  | "attendance"
  | "lessons"
  | "trials"
  | "enrollments"

interface ReportItem {
  name: string
  href: string
  description: string
  source: ReportSource
}

interface ReportGroup {
  title: string
  icon: typeof Filter
  color: string
  // Либо плоский список (заполняет сетку построчно), либо явные колонки
  // (каждая колонка — вертикальный список с фиксированным составом).
  reports?: ReportItem[]
  columns?: ReportItem[][]
}

const reportGroups: ReportGroup[] = [
  {
    title: "Маркетинг и продажи",
    icon: Filter,
    color: "text-blue-600",
    columns: [
      // Колонка 1 — лиды и воронка
      [
        { name: "Воронка продаж", href: "/reports/crm/funnel", description: "Заявки по этапам за месяц: новые/действующие, с пробным/без, детализация", source: "clients" },
        { name: "Лиды по менеджерам", href: "/reports/crm/leads-by-manager", description: "Создано лидов/заявок, записи на пробные и продажи по сотрудникам", source: "clients" },
        { name: "Лиды по дням", href: "/reports/crm/leads-by-day", description: "Созданные заявки по дням месяца", source: "subscriptions" },
        { name: "Лиды по каналам", href: "/reports/crm/leads-by-channel", description: "Созданные заявки (лиды) по каналам привлечения и дням месяца", source: "subscriptions" },
      ],
      // Колонка 2 — клиенты и пробные
      [
        { name: "Сегментация клиентов", href: "/reports/crm/segmentation", description: "Активные клиенты по сегментам (по настройкам: сумма или время)", source: "clients" },
        { name: "Доходимость по дням", href: "/reports/crm/conversion-by-days", description: "Воронка по дням: заявки → пробные → продажи → оплаты, с конверсией от заявок", source: "clients" },
        { name: "Детализация пробников", href: "/reports/crm/trial-details", description: "Все пробные за месяц с педагогом, статусом, датой посещения", source: "trials" },
        { name: "Не пришли на пробники", href: "/reports/crm/trial-no-show", description: "Список неявок на пробные занятия за месяц", source: "trials" },
      ],
      // Колонка 3 — продажи и прочее
      [
        { name: "Средний чек/абонемент", href: "/reports/crm/avg-check", description: "Средний чек (оплачено / кол-во платежей) + средняя стоимость абонемента по направлениям", source: "payments" },
        { name: "Допродажи", href: "/reports/crm/upsell", description: "Одно направление, истекающие, снизили активность", source: "subscriptions" },
        { name: "Активные абонементы (динамика)", href: "/reports/crm/active-subs-dynamics", description: "Создано / продлено / активно на конец периода по филиалам и направлениям", source: "subscriptions" },
        { name: "Скидки", href: "/reports/crm/marketing-bonuses", description: "Разовые бонусы на баланс (по каналам) + постоянные скидки на абонементы", source: "clients" },
        { name: "Эффективность обзвонов", href: "/reports/crm/call-efficiency", description: "Отработка кампаний, конверсия в пробные и продажи", source: "clients" },
        { name: "Продажи менеджеров по каналам", href: "/reports/crm/sales-by-channel", description: "Пробные и продажи в разрезе менеджеров (переключатель показателя)", source: "clients" },
      ],
    ],
  },
  {
    title: "Отток и удержание",
    icon: TrendingDown,
    color: "text-red-600",
    reports: [
      { name: "Детализация оттока", href: "/reports/churn/details", description: "Выбывшие клиенты по направлениям и инструкторам", source: "clients" },
      { name: "Непродлённые абонементы", href: "/reports/churn/not-renewed", description: "Активные в прошлом месяце без списаний", source: "subscriptions" },
      { name: "Потенциальный отток", href: "/reports/churn/potential", description: "Ученики с 3+ прогулами за месяц", source: "attendance" },
      { name: "Конверсия оттока по педагогам", href: "/reports/churn/by-instructor", description: "% оттока = выбывшие / активные абонементы (педагоги или филиалы)", source: "clients" },
      { name: "Отток по месяцам", href: "/reports/churn/by-months", description: "В какой месяц «срока жизни» чаще уходят клиенты", source: "clients" },
      { name: "Отток по направлениям и филиалам", href: "/reports/churn/by-directions", description: "Активные прошлого месяца, не продлённые в текущем", source: "subscriptions" },
      { name: "Сводный по абонементам по педагогам", href: "/reports/crm/subscriptions-by-instructor", description: "Активные, новые, выбывшие абонементы по педагогам", source: "subscriptions" },
      { name: "Конверсия пробных по педагогам", href: "/reports/crm/trial-conversion", description: "Пробные → клиенты по педагогам", source: "trials" },
    ],
  },
  {
    title: "Расписание и посещения",
    icon: Calendar,
    color: "text-green-600",
    reports: [
      { name: "Свободные места", href: "/reports/schedule/capacity", description: "Занято / свободно / % по группам", source: "enrollments" },
      { name: "Загруженность центра", href: "/reports/schedule/load", description: "Часы занятий с явками / рабочие часы по филиалам и кабинетам", source: "lessons" },
      { name: "Посещения", href: "/reports/attendance/visits", description: "Явки, прогулы, перерасчёты по группам", source: "attendance" },
      { name: "Неотмеченные дети", href: "/reports/attendance/unmarked", description: "Занятия, где не проставлены посещения", source: "lessons" },
      { name: "Отсутствие учеников / потери выручки", href: "/reports/attendance/absence-losses", description: "Перерасчёты (потери) и прогулы со списанием по ученикам", source: "attendance" },
      { name: "Сверка актива", href: "/reports/attendance/reconciliation", description: "Активные клиенты без оплаты и активации — «мёртвые души»", source: "clients" },
    ],
  },
  {
    title: "Финансы",
    icon: CreditCard,
    color: "text-purple-600",
    reports: [
      { name: "Финрез (P&L)", href: "/reports/finance/pnl", description: "Выручка − расходы − ЗП = прибыль", source: "payments" },
      { name: "P&L по направлениям", href: "/reports/finance/pnl-directions", description: "Прибыль и убытки в разрезе направлений", source: "attendance" },
      { name: "Выручка", href: "/reports/finance/revenue", description: "Отработанные абонементы по направлениям", source: "attendance" },
      { name: "Сводный по педагогам", href: "/reports/salary/by-instructor", description: "Занятия, ученики, ЗП по инструкторам", source: "attendance" },
      { name: "Должники", href: "/finance/debtors", description: "Плановый / фактический долг", source: "payments" },
      { name: "Ожидаемые поступления", href: "/reports/finance/expected-income", description: "Неоплаченные абонементы активных клиентов + прогноз на следующий месяц", source: "subscriptions" },
      { name: "Прогноз прибыли", href: "/reports/finance/profit-forecast", description: "Абонементы − ЗП − переменные − постоянные расходы", source: "subscriptions" },
      { name: "Поступления по дням", href: "/reports/finance/daily-income", description: "Ежедневные поступления нал/безнал", source: "payments" },
      { name: "Расчёты с учениками", href: "/reports/finance/student-settlements", description: "Баланс, начисление план/факт, оплата по ученикам", source: "subscriptions" },
      { name: "Доход от новых / упущенный по выбывшим", href: "/reports/finance/new-client-income", description: "Доход новых клиентов против упущенной выручки по выбывшим", source: "attendance" },
      { name: "Финрез по группам (формат C)", href: "/reports/finance/pnl-group", description: "Прибыльность каждой группы с распределением расходов", source: "attendance" },
      { name: "Остатки оплаченных занятий", href: "/reports/finance/remaining-lessons", description: "Сколько занятий осталось по абонементам и баланс на сегодня", source: "subscriptions" },
      { name: "% распределения финреза", href: "/reports/finance/financial-distribution", description: "Доля каждой статьи расходов и ЗП в выручке", source: "attendance" },
      { name: "Действующие скидки", href: "/reports/finance/linked-discounts", description: "Абонементы с активной скидкой (снимок)", source: "subscriptions" },
      { name: "Контроль корректировок занятий", href: "/reports/finance/lesson-adjustments-audit", description: "Аудит: кто менял стоимость отметок", source: "attendance" },
      { name: "Контроль скидок", href: "/reports/finance/discount-audit", description: "Аудит: кто и когда создавал скидки", source: "subscriptions" },
    ],
  },
  {
    title: "Зарплата и педагоги",
    icon: Wallet,
    color: "text-amber-600",
    reports: [
      { name: "Сколько денег приносит педагог", href: "/reports/salary/instructor-profitability", description: "Прибыльность педагога: выручка − ЗП − расходы", source: "attendance" },
      { name: "Мотивация администратора", href: "/reports/salary/admin-motivation", description: "Пробные, продажи новым и допродажи по администраторам", source: "trials" },
      { name: "Часы педагогов по дням", href: "/reports/salary/instructor-hours", description: "Отработанные часы за месяц по педагогам", source: "lessons" },
      { name: "Средняя ЗП педагогов", href: "/reports/salary/avg-salary", description: "Средняя стоимость часа = ЗП / часы", source: "attendance" },
      { name: "Прогноз сдельной оплаты", href: "/reports/salary/salary-forecast", description: "Прогноз ЗП сдельных педагогов по ставкам и расписанию", source: "attendance" },
      { name: "Расчёты с педагогами", href: "/reports/salary/salary-instructors", description: "Начислено, премии, штрафы, выплачено и остаток", source: "attendance" },
    ],
  },
]

// Все отчёты группы — из плоского списка или из колонок.
function groupReports(g: ReportGroup): ReportItem[] {
  return g.columns ? g.columns.flat() : g.reports ?? []
}

// Короткая подпись для бейджа в карточке отчёта. На текущий день — «сегодня»,
// на предыдущий — «вчера», иначе — DD.MM.
function formatFreshness(d: Date | null): string {
  if (!d) return "нет данных"
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return "сегодня"
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return "вчера"
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

function ReportCard({ report, updatedAt }: { report: ReportItem; updatedAt: Date | null }) {
  return (
    <Link
      href={report.href}
      className="rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{report.name}</p>
        <Badge
          variant="outline"
          className="shrink-0 text-xs font-normal text-muted-foreground"
          title={updatedAt ? `Последнее изменение исходных данных: ${updatedAt.toLocaleString("ru-RU")}` : "Нет данных по этому отчёту"}
        >
          {formatFreshness(updatedAt)}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
    </Link>
  )
}

export default async function ReportsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const [
    clientsAgg,
    paymentsAgg,
    subsAgg,
    attsAgg,
    lessonsAgg,
    trialsAgg,
    enrollAgg,
  ] = await Promise.all([
    db.client.aggregate({ where: { tenantId, deletedAt: null }, _max: { updatedAt: true } }),
    db.payment.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    db.subscription.aggregate({ where: { tenantId, deletedAt: null }, _max: { updatedAt: true } }),
    db.attendance.aggregate({ where: { tenantId }, _max: { markedAt: true } }),
    db.lesson.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    db.trialLesson.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    db.groupEnrollment.aggregate({ where: { tenantId, deletedAt: null }, _max: { updatedAt: true } }),
  ])

  const updatedBy: Record<ReportSource, Date | null> = {
    clients: clientsAgg._max.updatedAt,
    payments: paymentsAgg._max.createdAt,
    subscriptions: subsAgg._max.updatedAt,
    attendance: attsAgg._max.markedAt,
    lessons: lessonsAgg._max.updatedAt,
    trials: trialsAgg._max.updatedAt,
    enrollments: enrollAgg._max.updatedAt,
  }

  const totalCount = reportGroups.flatMap(groupReports).length

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Отчёты</h1>
          <PageHelp pageKey="reports" />
        </div>
        <p className="text-sm text-muted-foreground">
          {totalCount} отчётов · бейдж показывает дату последнего обновления исходных данных
        </p>
      </div>

      <div className="space-y-6">
        {reportGroups.map((group) => (
          <Card key={group.title}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <group.icon className={`size-5 ${group.color}`} />
                {group.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.columns
                  ? group.columns.map((col, i) => (
                      <div key={i} className="flex flex-col gap-3">
                        {col.map((report) => (
                          <ReportCard key={report.name} report={report} updatedAt={updatedBy[report.source]} />
                        ))}
                      </div>
                    ))
                  : (group.reports ?? []).map((report) => (
                      <ReportCard key={report.name} report={report} updatedAt={updatedBy[report.source]} />
                    ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
