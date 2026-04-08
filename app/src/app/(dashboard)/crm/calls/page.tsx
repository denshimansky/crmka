import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Phone, Users } from "lucide-react"
import Link from "next/link"
import { CreateCampaignDialog } from "./create-campaign-dialog"
import { PageHelp } from "@/components/page-help"

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  closed: "Закрыт",
  archived: "Архив",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  closed: "secondary",
  archived: "outline",
}

export default async function CallsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const campaigns = await db.callCampaign.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  const activeCampaigns = campaigns.filter(c => c.status === "active").length
  const totalContacts = campaigns.reduce((s, c) => s + c.totalItems, 0)
  const totalCompleted = campaigns.reduce((s, c) => s + c.completedItems, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Обзвон</h1>
          <PageHelp pageKey="crm/calls" />
        </div>
        <CreateCampaignDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50">
              <Phone className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Активных кампаний</p>
              <p className="text-2xl font-bold">{activeCampaigns}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-50">
              <Users className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Всего контактов</p>
              <p className="text-2xl font-bold">{totalContacts}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-purple-50">
              <Phone className="size-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Обзвонено</p>
              <p className="text-2xl font-bold">{totalCompleted}</p>
            </div>
          </CardContent>
        </Card>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
