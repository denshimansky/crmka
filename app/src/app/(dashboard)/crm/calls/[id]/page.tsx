import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Phone, Users } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CallItemRow } from "./call-item-row"

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { id } = await params

  const campaign = await db.callCampaign.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!campaign) notFound()

  const items = await db.callCampaignItem.findMany({
    where: { campaignId: id, tenantId },
    include: {
      client: {
        select: {
          id: true, firstName: true, lastName: true, phone: true,
          wards: { select: { firstName: true, birthDate: true }, take: 1 },
        },
      },
    },
    orderBy: { status: "asc" },
  })

  const pending = items.filter(i => i.status === "pending").length
  const completed = items.filter(i => i.status !== "pending").length
  const percent = items.length > 0 ? Math.round((completed / items.length) * 100) : 0

  const rows = items.map(i => {
    const name = [i.client.lastName, i.client.firstName].filter(Boolean).join(" ") || "Без имени"
    const ward = i.client.wards[0]
    const wardInfo = ward
      ? `${ward.firstName}${ward.birthDate ? ` (${new Date().getFullYear() - ward.birthDate.getFullYear()} лет)` : ""}`
      : "—"
    return {
      id: i.id,
      clientId: i.clientId,
      clientName: name,
      phone: i.client.phone || "—",
      wardInfo,
      status: i.status,
      comment: i.comment,
      result: i.result,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/calls" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            Создана {campaign.createdAt.toLocaleDateString("ru-RU")}
          </p>
        </div>
        <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="ml-auto">
          {campaign.status === "active" ? "Активная" : campaign.status === "closed" ? "Закрыта" : "Архив"}
        </Badge>
      </div>

      {/* Прогресс */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50">
              <Users className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Всего контактов</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-50">
              <Phone className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Обзвонено</p>
              <p className="text-2xl font-bold text-green-600">{completed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-50">
              <Phone className="size-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Осталось</p>
              <p className="text-2xl font-bold text-orange-600">{pending}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Прогресс-бар */}
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Прогресс</span>
          <span className="font-medium">{percent}%</span>
        </div>
        <div className="h-3 rounded-full bg-muted">
          <div className="h-3 rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {/* Таблица контактов */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет контактов в кампании
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Подопечный</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Комментарий</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <CallItemRow key={item.id} item={item} campaignId={id} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
