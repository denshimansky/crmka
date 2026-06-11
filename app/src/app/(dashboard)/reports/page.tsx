import { PageHelp } from "@/components/page-help"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Filter, TrendingDown, Calendar, CreditCard } from "lucide-react"
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
  reports: ReportItem[]
}

const reportGroups: ReportGroup[] = [
  {
    title: "CRM и маркетинг",
    icon: Filter,
    color: "text-blue-600",
    reports: [
      { name: "Воронка продаж", href: "/reports/crm/funnel", description: "Заявки по этапам за месяц: новые/действующие, с пробным/без, детализация", source: "clients" },
      { name: "Конверсия пробных", href: "/reports/crm/trial-conversion", description: "Пробные → клиенты по педагогам", source: "trials" },
      { name: "Средний чек", href: "/reports/crm/avg-check", description: "Оплачено / кол-во платежей", source: "payments" },
      { name: "Допродажи", href: "/reports/crm/upsell", description: "Одно направление, истекающие, снизили активность", source: "subscriptions" },
      { name: "Активные абонементы (динамика)", href: "/reports/crm/active-subs-dynamics", description: "Создано / продлено / активно на конец периода по филиалам и направлениям", source: "subscriptions" },
      { name: "Доходимость по дням", href: "/reports/crm/conversion-by-days", description: "Воронка по дням: заявки → пробные → продажи → оплаты, с конверсией от заявок", source: "clients" },
      { name: "Разовые скидки", href: "/reports/crm/marketing-bonuses", description: "Начисленные бонусы на баланс клиентов с разбивкой по каналам и ответственным", source: "clients" },
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
    ],
  },
]

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

  const totalCount = reportGroups.flatMap(g => g.reports).length

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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.reports.map((report) => {
                  const updatedAt = updatedBy[report.source]
                  return (
                    <Link
                      key={report.name}
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
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
