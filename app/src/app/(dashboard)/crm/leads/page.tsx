import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import Link from "next/link"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { PageHelp } from "@/components/page-help"
import { QuickLeadButton } from "@/components/quick-lead-button"

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

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  trial_scheduled: "secondary",
  trial_attended: "secondary",
  awaiting_payment: "outline",
  active_client: "default",
  potential: "outline",
  non_target: "outline",
  blacklisted: "destructive",
  archived: "outline",
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default async function FunnelPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Лиды (не active_client) — рабочая воронка
  const leads = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      funnelStatus: { notIn: ["active_client", "archived", "blacklisted"] },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      funnelStatus: true,
      nextContactDate: true,
      createdAt: true,
      branch: { select: { name: true } },
      assignee: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ funnelStatus: "asc" }, { createdAt: "desc" }],
    take: 200,
  })

  // Счётчики по статусам
  const counts = await db.client.groupBy({
    by: ["funnelStatus"],
    where: { tenantId, deletedAt: null },
    _count: true,
  })
  const countMap = new Map(counts.map(c => [c.funnelStatus as string, c._count]))

  const funnelStages = [
    "new", "trial_scheduled", "trial_attended", "awaiting_payment",
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Лиды</h1>
          <PageHelp pageKey="crm/leads" />
        </div>
        <CreateClientDialog branches={branches} />
      </div>

      {/* Счётчики */}
      <div className="flex flex-wrap gap-3">
        {funnelStages.map((status) => (
          <Card key={status} className="min-w-[140px]">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{countMap.get(status) || 0}</p>
              <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
            </CardContent>
          </Card>
        ))}
        <Card className="min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{countMap.get("active_client") || 0}</p>
            <p className="text-xs text-muted-foreground">Активные</p>
          </CardContent>
        </Card>
      </div>

      {/* Таблица лидов */}
      {leads.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет лидов в воронке
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead>След. контакт</TableHead>
                <TableHead>Создан</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const name = [lead.lastName, lead.firstName].filter(Boolean).join(" ") || "Без имени"
                const assignee = lead.assignee
                  ? [lead.assignee.lastName, lead.assignee.firstName].filter(Boolean).join(" ")
                  : "—"
                return (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Link href={`/crm/clients/${lead.id}`} className="font-medium text-primary hover:underline">
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lead.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_COLORS[lead.funnelStatus] || "outline"}>
                        {STATUS_LABELS[lead.funnelStatus] || lead.funnelStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lead.branch?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{assignee}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.nextContactDate ? formatDate(lead.nextContactDate) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(lead.createdAt)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <QuickLeadButton />
    </div>
  )
}
