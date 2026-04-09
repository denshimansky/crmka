import { PageHelp } from "@/components/page-help"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Filter, TrendingDown, Calendar, CreditCard } from "lucide-react"
import Link from "next/link"

interface ReportItem {
  name: string
  href: string
  description: string
  ready: boolean
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
      { name: "Воронка продаж", href: "/reports/crm/funnel", description: "Лиды по статусам, конверсии между этапами", ready: true },
      { name: "Средний чек", href: "/reports/crm/avg-check", description: "Оплачено / кол-во платежей", ready: true },
      { name: "Допродажи", href: "/reports/crm/upsell", description: "Одно направление, истекающие, снизили активность", ready: true },
    ],
  },
  {
    title: "Отток и удержание",
    icon: TrendingDown,
    color: "text-red-600",
    reports: [
      { name: "Детализация оттока", href: "/reports/churn/details", description: "Выбывшие клиенты по направлениям и инструкторам", ready: true },
      { name: "Непродлённые абонементы", href: "/reports/churn/not-renewed", description: "Активные в прошлом месяце без списаний", ready: true },
      { name: "Потенциальный отток", href: "/reports/churn/potential", description: "Ученики с 3+ прогулами за месяц", ready: true },
    ],
  },
  {
    title: "Расписание и посещения",
    icon: Calendar,
    color: "text-green-600",
    reports: [
      { name: "Свободные места", href: "/reports/schedule/capacity", description: "Занято / свободно / % по группам", ready: true },
      { name: "Посещения", href: "/reports/attendance/visits", description: "Явки, прогулы, перерасчёты по группам", ready: true },
      { name: "Неотмеченные дети", href: "/reports/attendance/unmarked", description: "Занятия, где не проставлены посещения", ready: true },
    ],
  },
  {
    title: "Финансы",
    icon: CreditCard,
    color: "text-purple-600",
    reports: [
      { name: "Финрез (P&L)", href: "/reports/finance/pnl", description: "Выручка − расходы − ЗП = прибыль", ready: true },
      { name: "P&L по направлениям", href: "/reports/finance/pnl-directions", description: "Прибыль и убытки в разрезе направлений", ready: true },
      { name: "Выручка", href: "/reports/finance/revenue", description: "Отработанные абонементы по направлениям", ready: true },
      { name: "Сводный по педагогам", href: "/reports/salary/by-instructor", description: "Занятия, ученики, ЗП по инструкторам", ready: true },
      { name: "Должники", href: "/finance/debtors", description: "Плановый / фактический долг", ready: true },
    ],
  },
]

export default function ReportsPage() {
  const readyCount = reportGroups.flatMap(g => g.reports).filter(r => r.ready).length
  const totalCount = reportGroups.flatMap(g => g.reports).length

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Отчёты</h1>
          <PageHelp pageKey="reports" />
        </div>
        <p className="text-sm text-muted-foreground">
          {readyCount} из {totalCount} отчётов доступно
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
                {group.reports.map((report) => (
                  <Link
                    key={report.name}
                    href={report.ready ? report.href : "#"}
                    className={`rounded-lg border p-3 transition-colors ${
                      report.ready ? "hover:bg-muted/50" : "cursor-default opacity-50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium">{report.name}</p>
                      {report.ready ? (
                        <Badge variant="default" className="text-xs">Готов</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Скоро</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
