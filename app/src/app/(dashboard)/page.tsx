import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Users, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Circle, Clock, BarChart3,
} from "lucide-react"
import Link from "next/link"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export default async function DashboardPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = new Date(Date.UTC(year, month, 1))
  const monthEnd = new Date(Date.UTC(year, month + 1, 0))
  const today = new Date(Date.UTC(year, month, now.getDate()))

  // === МЕТРИКИ ===

  // Активные ученики (уникальные клиенты с активными абонементами)
  const activeSubscriptions = await db.subscription.count({
    where: { tenantId, deletedAt: null, status: "active" },
  })

  // Выручка (списания с абонементов за месяц)
  const revenueAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      attendanceType: { countsAsRevenue: true },
    },
    select: { chargeAmount: true },
  })
  const monthRevenue = revenueAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Расходы за месяц
  const monthExpensesData = await db.expense.aggregate({
    where: { tenantId, deletedAt: null, date: { gte: monthStart, lte: monthEnd } },
    _sum: { amount: true },
  })
  const monthExpenses = Number(monthExpensesData._sum.amount || 0)

  // Должники
  const debtors = await db.client.findMany({
    where: { tenantId, deletedAt: null, clientBalance: { lt: 0 } },
    select: { clientBalance: true },
  })
  const debtorCount = debtors.length
  const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.clientBalance)), 0)

  // Задачи на сегодня
  const todayTasks = await db.task.findMany({
    where: {
      tenantId, deletedAt: null, status: "pending",
      dueDate: { lte: today },
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 8,
  })

  // Неотмеченные занятия (прошедшие, без посещений)
  const unmarkedLessons = await db.lesson.findMany({
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
    take: 5,
  })

  // Воронка — по статусам
  const funnelCounts = await db.client.groupBy({
    by: ["funnelStatus"],
    where: { tenantId, deletedAt: null },
    _count: true,
  })

  const funnelMap = new Map(funnelCounts.map(f => [f.funnelStatus, f._count]))
  const funnelStages = [
    { stage: "Новые", count: funnelMap.get("new") || 0, color: "bg-blue-500" },
    { stage: "Пробное записано", count: funnelMap.get("trial_scheduled") || 0, color: "bg-cyan-500" },
    { stage: "Ожидание оплаты", count: funnelMap.get("awaiting_payment") || 0, color: "bg-yellow-500" },
    { stage: "Активные", count: funnelMap.get("active_client") || 0, color: "bg-green-500" },
  ]
  const maxFunnel = Math.max(...funnelStages.map(f => f.count), 1)

  // Заполняемость групп (топ-5)
  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    select: {
      name: true,
      maxStudents: true,
      enrollments: { where: { isActive: true, deletedAt: null }, select: { id: true } },
    },
    orderBy: { name: "asc" },
    take: 10,
  })

  const groupCapacity = groups.map(g => ({
    name: g.name,
    enrolled: g.enrollments.length,
    max: g.maxStudents,
    percent: g.maxStudents > 0 ? Math.round((g.enrollments.length / g.maxStudents) * 100) : 0,
  })).sort((a, b) => b.percent - a.percent).slice(0, 5)

  const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "long" })

  const stats = [
    { title: "Активные абонементы", value: String(activeSubscriptions), icon: Users, color: "text-green-600", bg: "bg-green-50", href: "/crm/clients" },
    { title: "Выручка за месяц", value: formatMoney(monthRevenue), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50", href: "/reports/finance/pnl" },
    { title: "Расходы за месяц", value: formatMoney(monthExpenses), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50", href: "/finance/expenses" },
    { title: "Должники", value: `${debtorCount} / ${formatMoney(totalDebt)}`, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50", href: "/finance/debtors" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Главная</h1>
        <span className="text-sm text-muted-foreground">{dateStr}</span>
      </div>

      {/* Карточки статистики */}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Задачи */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <Link href="/tasks" className="hover:underline">Задачи на сегодня</Link>
              <Badge variant="secondary">{todayTasks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {todayTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет задач</p>
            ) : (
              todayTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-sm">
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                  <span>{task.title}</span>
                  {task.client && (
                    <span className="text-muted-foreground">
                      — {[task.client.lastName, task.client.firstName].filter(Boolean).join(" ")}
                    </span>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Неотмеченные */}
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

        {/* Воронка */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              <Link href="/reports/crm/funnel" className="hover:underline">Воронка продаж</Link>
            </CardTitle>
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
      </div>

      {/* Заполняемость */}
      {groupCapacity.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-5 text-muted-foreground" />
              <Link href="/reports/schedule/capacity" className="hover:underline">Заполняемость групп</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {groupCapacity.map((g) => (
                <div key={g.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="text-muted-foreground">{g.enrolled}/{g.max}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className={`h-2 rounded-full ${g.percent >= 90 ? "bg-red-500" : g.percent >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${g.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
