import { getSession, getBranchScope } from "@/lib/session"
import { scopeBranch } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FilePlus, PhoneCall, PhoneOff, Users, XCircle } from "lucide-react"
import Link from "next/link"
import { CreateCampaignDialog, CreateTaskCampaignDialog } from "./create-campaign-dialog"
import { CampaignActionsCell } from "./campaign-actions"
import { PageHelp } from "@/components/page-help"

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  closed: "Закрыт",
  archived: "Архивный",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  closed: "secondary",
  archived: "outline",
}

export default async function CallsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()

  // «Сегодня» по московскому времени (UTC+3, фиксированный офсет): контейнер
  // живёт в UTC, поэтому границы дня для calledAt строим сразу в МСК.
  const now = new Date()
  const todayMsk = now.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" })
  const todayStart = new Date(`${todayMsk}T00:00:00.000+03:00`)
  const todayEnd = new Date(`${todayMsk}T23:59:59.999+03:00`)

  // Позиции обзвона по неудалённым кампаниям, видимые в scope филиалов (ADM-04) —
  // как на карточке кампании. При полном доступе scopeClientByBranch → {}.
  const itemWhere = {
    tenantId,
    campaign: { deletedAt: null },
    client: scopeClientByBranch(scope),
  }
  const todayWhere = { ...itemWhere, calledAt: { gte: todayStart, lte: todayEnd } }

  const [campaigns, branches, byStatusTotal, byStatusToday, appsTotal, appsToday] =
    await Promise.all([
      db.callCampaign.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.branch.findMany({
        where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.callCampaignItem.groupBy({ by: ["status"], where: itemWhere, _count: true }),
      db.callCampaignItem.groupBy({ by: ["status"], where: todayWhere, _count: true }),
      db.callCampaignItem.count({ where: { ...itemWhere, result: "application" } }),
      db.callCampaignItem.count({ where: { ...todayWhere, result: "application" } }),
    ])

  // Срезы по статусу → карты «статус → количество» (всего и за сегодня).
  const totalByStatus: Record<string, number> = {}
  for (const r of byStatusTotal) totalByStatus[r.status] = r._count
  const todayByStatus: Record<string, number> = {}
  for (const r of byStatusToday) todayByStatus[r.status] = r._count

  // Пять карточек-показателей (как на карточке кампании), агрегированные по всем
  // кампаниям: крупно — всего, мелко — за сегодня.
  const cardStats = [
    {
      key: "total",
      label: "Всего контактов",
      total: Object.values(totalByStatus).reduce((s, n) => s + n, 0),
      today: Object.values(todayByStatus).reduce((s, n) => s + n, 0),
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      key: "apps",
      label: "Создано заявок",
      total: appsTotal,
      today: appsToday,
      icon: FilePlus,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      key: "refused",
      label: "Отказ",
      total: totalByStatus["completed"] ?? 0,
      today: todayByStatus["completed"] ?? 0,
      icon: XCircle,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      key: "callback",
      label: "Перезвонить",
      total: totalByStatus["callback"] ?? 0,
      today: todayByStatus["callback"] ?? 0,
      icon: PhoneCall,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      key: "noanswer",
      label: "Не ответил",
      total: totalByStatus["no_answer"] ?? 0,
      today: todayByStatus["no_answer"] ?? 0,
      icon: PhoneOff,
      color: "text-slate-600",
      bg: "bg-slate-100",
    },
  ]

  // Архивные кампании — в конец списка (внутри групп сохраняется порядок запроса,
  // createdAt desc).
  const orderedCampaigns = [
    ...campaigns.filter(c => c.status !== "archived"),
    ...campaigns.filter(c => c.status === "archived"),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Обзвон</h1>
          <PageHelp pageKey="crm/calls" />
        </div>
        <div className="flex items-center gap-2">
          <CreateCampaignDialog branches={branches} />
          <CreateTaskCampaignDialog />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cardStats.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.key}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${c.bg}`}>
                    <Icon className={`size-4 ${c.color}`} />
                  </div>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
                <p className={`mt-2 text-2xl font-bold ${c.color}`}>{c.total}</p>
                <p className="text-xs text-muted-foreground">
                  за сегодня: <span className="font-medium text-foreground">{c.today}</span>
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет кампаний обзвона
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Кампания</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead className="text-center">Контакты</TableHead>
                <TableHead className="text-center">Обзвонено</TableHead>
                <TableHead className="text-center">Осталось</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedCampaigns.map((c) => (
                <TableRow key={c.id} className={c.status === "archived" ? "opacity-60" : ""}>
                  <TableCell>
                    <Link href={`/crm/calls/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                  <TableCell className="text-center">{c.totalItems}</TableCell>
                  <TableCell className="text-center text-green-600">{c.completedItems}</TableCell>
                  <TableCell className="text-center text-orange-600">{c.totalItems - c.completedItems}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[c.status] || "outline"}>
                      {STATUS_LABELS[c.status] || c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <CampaignActionsCell campaignId={c.id} status={c.status} campaignName={c.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
