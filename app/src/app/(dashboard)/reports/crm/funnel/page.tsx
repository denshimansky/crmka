import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%"
  return Math.round((value / total) * 100) + "%"
}

const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  active_client: "Активный клиент",
  potential: "Потенциальный",
  non_target: "Не целевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500",
  trial_scheduled: "bg-cyan-500",
  trial_attended: "bg-teal-500",
  awaiting_payment: "bg-yellow-500",
  active_client: "bg-green-500",
  potential: "bg-gray-400",
  non_target: "bg-gray-300",
  blacklisted: "bg-red-500",
  archived: "bg-gray-200",
}

export default async function FunnelReportPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Считаем клиентов по статусам воронки
  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null },
    select: { funnelStatus: true, createdAt: true, firstPaymentDate: true },
  })

  const totalClients = clients.length

  // Группировка по статусам
  const statusCounts = new Map<string, number>()
  for (const c of clients) {
    statusCounts.set(c.funnelStatus, (statusCounts.get(c.funnelStatus) || 0) + 1)
  }

  // Этапы воронки (в порядке воронки)
  const funnelStages = [
    "new", "trial_scheduled", "trial_attended", "awaiting_payment", "active_client",
  ]

  const otherStages = ["potential", "non_target", "blacklisted", "archived"]

  // Конверсии
  const funnelData = funnelStages.map((status) => ({
    status,
    label: STATUS_LABELS[status] || status,
    count: statusCounts.get(status) || 0,
    color: STATUS_COLORS[status],
  }))

  const otherData = otherStages
    .map((status) => ({
      status,
      label: STATUS_LABELS[status] || status,
      count: statusCounts.get(status) || 0,
    }))
    .filter(d => d.count > 0)

  // Метрики за текущий месяц
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const newThisMonth = clients.filter(c => c.createdAt >= monthStart).length
  const convertedThisMonth = clients.filter(c => c.firstPaymentDate && c.firstPaymentDate >= monthStart).length

  const maxCount = Math.max(...funnelData.map(d => d.count), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Воронка продаж</h1>
          <p className="text-sm text-muted-foreground">Распределение клиентов по этапам воронки</p>
        </div>
      </div>

      {/* Метрики */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего клиентов</p>
            <p className="text-2xl font-bold">{totalClients}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Новых за месяц</p>
            <p className="text-2xl font-bold text-blue-600">{newThisMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Конверсий за месяц</p>
            <p className="text-2xl font-bold text-green-600">{convertedThisMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Конверсия</p>
            <p className="text-2xl font-bold">
              {formatPercent(statusCounts.get("active_client") || 0, totalClients)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Воронка */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Этапы воронки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {funnelData.map((stage, i) => (
            <div key={stage.status} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{stage.count}</span>
                  <Badge variant="outline" className="text-xs">
                    {formatPercent(stage.count, totalClients)}
                  </Badge>
                  {i > 0 && funnelData[i - 1].count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({formatPercent(stage.count, funnelData[i - 1].count)} от пред.)
                    </span>
                  )}
                </div>
              </div>
              <div className="h-8 rounded bg-muted">
                <div
                  className={`h-8 rounded ${stage.color} flex items-center justify-center text-xs font-medium text-white transition-all`}
                  style={{ width: `${Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 5 : 0)}%` }}
                >
                  {stage.count > 0 ? stage.count : ""}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Прочие статусы */}
      {otherData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Прочие статусы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {otherData.map((d) => (
                <div key={d.status} className="text-sm">
                  <span className="text-muted-foreground">{d.label}:</span>{" "}
                  <span className="font-medium">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
