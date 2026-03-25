import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { dashboardStats, formatMoney } from "@/lib/demo-data"
import { Users, TrendingUp, FlaskConical, AlertTriangle, CheckCircle2, Circle, Clock } from "lucide-react"

const stats = [
  { title: "Активные ученики", value: dashboardStats.activeStudents.toString(), icon: Users, color: "text-green-600", bg: "bg-green-50" },
  { title: "Выручка за месяц", value: formatMoney(dashboardStats.monthRevenue), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
  { title: "Пробных записано", value: dashboardStats.trialScheduled.toString(), icon: FlaskConical, color: "text-yellow-600", bg: "bg-yellow-50" },
  { title: "Должники", value: `${dashboardStats.debtors} / ${formatMoney(dashboardStats.debtAmount)}`, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
]

const tasks = [
  { text: "Позвонить Козлову — пробное завтра", done: false, priority: "high" },
  { text: "Оплата: Сидорова — долг 2 400 ₽", done: false, priority: "high" },
  { text: "День рождения: Аня Иванова (8 лет)", done: false, priority: "medium" },
  { text: "Проверить остатки канцтоваров", done: true, priority: "low" },
  { text: "Закрыть период: февраль 2026", done: false, priority: "medium" },
]

const unmarked = [
  { time: "09:00", group: "Развивайка 3-4", instructor: "Петрова Н.", students: 8 },
  { time: "10:00", group: "Английский 5-6", instructor: "Сидоров А.", students: 6 },
  { time: "11:00", group: "Рисование 6-7", instructor: "Морозова О.", students: 7 },
]

const funnel = [
  { stage: "Новые лиды", count: 14, color: "bg-blue-500" },
  { stage: "Пробное записано", count: 8, color: "bg-yellow-500" },
  { stage: "Ожидание оплаты", count: 4, color: "bg-orange-500" },
  { stage: "Активные", count: 87, color: "bg-green-500" },
]

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Главная</h1>
        <span className="text-sm text-muted-foreground">25 марта 2026, среда</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
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
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              Задачи на сегодня
              <Badge variant="secondary">{tasks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {task.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-green-500" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={task.done ? "text-muted-foreground line-through" : ""}>{task.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              Неотмеченные занятия
              <Badge variant="destructive">{unmarked.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unmarked.map((lesson, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="font-medium">{lesson.time}</span>
                  <span>{lesson.group}</span>
                </div>
                <span className="text-muted-foreground">{lesson.students} уч.</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Воронка продаж</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((stage) => (
              <div key={stage.stage} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{stage.stage}</span>
                  <span className="font-bold">{stage.count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className={`h-2 rounded-full ${stage.color}`} style={{ width: `${Math.min((stage.count / 87) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
