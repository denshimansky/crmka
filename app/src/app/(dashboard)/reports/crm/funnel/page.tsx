import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
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
  application: "Заявка",
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
  application: "bg-sky-500",
  trial_scheduled: "bg-cyan-500",
  trial_attended: "bg-teal-500",
  awaiting_payment: "bg-yellow-500",
  active_client: "bg-green-500",
  potential: "bg-gray-400",
  non_target: "bg-gray-300",
  blacklisted: "bg-red-500",
  archived: "bg-gray-200",
}

export default async function FunnelReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Воронка считается в двух плоскостях:
  // - new / active_client / прочие статусы контакта — по родителям (Client);
  // - application / trial_* / awaiting_payment — по сделкам (Ward.salesStage),
  //   потому что у одного родителя дети могут быть на разных этапах.
  const [allClients, allWards] = await Promise.all([
    db.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { funnelStatus: true, createdAt: true, firstPaymentDate: true },
    }),
    db.ward.findMany({
      where: { tenantId, client: { deletedAt: null } },
      select: { salesStage: true, salesStageAt: true },
    }),
  ])

  const totalClients = allClients.length

  // === БЛОК 1: Воронка текущего месяца ===
  const monthClients = allClients.filter(c => c.createdAt >= monthStart && c.createdAt <= monthEnd)

  // Новые лиды периода — по родителям (статус new + создание в периоде).
  const periodNew = allClients.filter(
    c => c.funnelStatus === "new" && c.createdAt >= monthStart && c.createdAt <= monthEnd
  ).length

  // Сделочные стадии периода — по Ward, который поднялся в стадию в течение месяца.
  const periodWardsByStage = new Map<string, number>()
  for (const w of allWards) {
    if (w.salesStageAt && w.salesStageAt >= monthStart && w.salesStageAt <= monthEnd) {
      periodWardsByStage.set(w.salesStage, (periodWardsByStage.get(w.salesStage) || 0) + 1)
    }
  }

  // Конверсии периода — по родителям (firstPaymentDate в периоде).
  const convertedThisMonth = allClients.filter(
    c => c.firstPaymentDate && c.firstPaymentDate >= monthStart && c.firstPaymentDate <= monthEnd
  ).length

  const funnelData = [
    { status: "new", label: STATUS_LABELS.new, count: periodNew, color: STATUS_COLORS.new },
    { status: "application", label: STATUS_LABELS.application, count: periodWardsByStage.get("application") || 0, color: STATUS_COLORS.application },
    { status: "trial_scheduled", label: STATUS_LABELS.trial_scheduled, count: periodWardsByStage.get("trial_scheduled") || 0, color: STATUS_COLORS.trial_scheduled },
    { status: "trial_attended", label: STATUS_LABELS.trial_attended, count: periodWardsByStage.get("trial_attended") || 0, color: STATUS_COLORS.trial_attended },
    { status: "awaiting_payment", label: STATUS_LABELS.awaiting_payment, count: periodWardsByStage.get("awaiting_payment") || 0, color: STATUS_COLORS.awaiting_payment },
    { status: "active_client", label: STATUS_LABELS.active_client, count: convertedThisMonth, color: STATUS_COLORS.active_client },
  ]

  // === БЛОК 2: Перетекающие с прошлых месяцев ===
  // Родители: new / potential, созданные до начала месяца, ещё в работе.
  const carryoverClientCounts = new Map<string, number>()
  for (const c of allClients) {
    if (c.createdAt < monthStart && (c.funnelStatus === "new" || c.funnelStatus === "potential")) {
      carryoverClientCounts.set(c.funnelStatus, (carryoverClientCounts.get(c.funnelStatus) || 0) + 1)
    }
  }
  // Сделки: ward в стадии до начала периода и ещё там висит.
  const carryoverWardCounts = new Map<string, number>()
  for (const w of allWards) {
    if (w.salesStage !== "none" && (!w.salesStageAt || w.salesStageAt < monthStart)) {
      carryoverWardCounts.set(w.salesStage, (carryoverWardCounts.get(w.salesStage) || 0) + 1)
    }
  }
  const carryoverStages = [
    "new",
    "application",
    "trial_scheduled",
    "trial_attended",
    "awaiting_payment",
    "potential",
  ]
  const carryoverData = carryoverStages
    .map((status) => ({
      status,
      label: STATUS_LABELS[status] || status,
      count:
        (carryoverClientCounts.get(status) || 0) +
        (carryoverWardCounts.get(status) || 0),
    }))
    .filter(d => d.count > 0)
  const carryoverTotal = carryoverData.reduce((a, d) => a + d.count, 0)

  const otherStages = ["non_target", "blacklisted", "archived"]
  const otherData = otherStages
    .map((status) => ({
      status,
      label: STATUS_LABELS[status] || status,
      count: allClients.filter(c => c.funnelStatus === status).length,
    }))
    .filter(d => d.count > 0)

  // Метрики
  const newThisMonth = monthClients.length

  const maxCount = Math.max(...funnelData.map(d => d.count), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Воронка продаж</h1>
            <PageHelp pageKey="reports/crm/funnel" />
          </div>
          <p className="text-sm text-muted-foreground">Распределение клиентов по этапам воронки</p>
        </div>
        <MonthPicker />
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
              {formatPercent(allClients.filter(c => c.funnelStatus === "active_client").length, totalClients)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Воронка текущего месяца */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Воронка — новые за месяц ({newThisMonth})</CardTitle>
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

      {/* Перетекающие с прошлых месяцев */}
      {carryoverData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Перетекающие с прошлых месяцев ({carryoverTotal})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {carryoverData.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-sm">
                  <span>{d.label}</span>
                  <span className="font-medium">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
