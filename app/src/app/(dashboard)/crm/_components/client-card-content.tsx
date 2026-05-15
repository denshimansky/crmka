import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CreditCard, FileText } from "lucide-react"
import { ClientTabs } from "../clients/[id]/client-tabs"
import { EditClientDialog } from "../clients/[id]/edit-client-dialog"
import { UnprolongedCommentsSection } from "../clients/[id]/unprolonged-comments"
import { LeadStatusActions } from "./lead-status-actions"

const SEGMENT_LABELS: Record<string, string> = {
  new_client: "Новый",
  standard: "Стандарт",
  regular: "Постоянный",
  vip: "VIP",
}

const SEGMENT_COLORS: Record<string, string> = {
  new_client: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  standard: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  regular: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  vip: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
}

const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  upsell: "Допродажа",
  churned: "Выбывший",
  returning: "Возврат",
  archived: "Архив",
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export async function ClientCardContent({
  id,
  backHref,
}: {
  id: string
  backHref: string
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      wards: true,
      branch: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  })

  if (!client) notFound()

  const fullName =
    [client.lastName, client.firstName, client.patronymic]
      .filter(Boolean)
      .join(" ") || "Без имени"
  const balance = Number(client.clientBalance)
  const moneyLtv = Number(client.moneyLtv)
  const assigneeName = client.assignee
    ? [client.assignee.lastName, client.assignee.firstName].filter(Boolean).join(" ")
    : "—"

  const wardsForClient = client.wards.map((w) => ({
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    birthDate: w.birthDate?.toISOString() || null,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={backHref}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{fullName}</h1>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT_COLORS[client.segment] || ""}`}
            >
              {SEGMENT_LABELS[client.segment] || client.segment}
            </span>
            {client.clientStatus && (
              <Badge
                variant={
                  client.clientStatus === "churned"
                    ? "destructive"
                    : client.clientStatus === "active"
                      ? "default"
                      : "secondary"
                }
              >
                {CLIENT_STATUS_LABELS[client.clientStatus] || client.clientStatus}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {client.phone || "—"} · {client.email || "—"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Баланс</div>
          <div
            className={`text-2xl font-bold ${
              balance > 0
                ? "text-green-600"
                : balance < 0
                  ? "text-red-600"
                  : "text-muted-foreground"
            }`}
          >
            {balance === 0 ? "0 ₽" : formatMoney(balance)}
          </div>
        </div>
      </div>

      {/* Action buttons / Lead actions */}
      {client.clientStatus ? (
        <div className="flex gap-2">
          <Button disabled>
            <CreditCard className="mr-2 size-4" />
            Оплата
          </Button>
          <Button variant="outline" disabled>
            <FileText className="mr-2 size-4" />
            Абонемент
          </Button>
        </div>
      ) : (
        <LeadStatusActions
          clientId={client.id}
          currentStatus={client.funnelStatus}
          wards={client.wards.map((w) => ({
            id: w.id,
            firstName: w.firstName,
            lastName: w.lastName,
          }))}
        />
      )}

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Main content: tabs */}
        <ClientTabs clientId={client.id} wards={wardsForClient} />

        {/* Sidebar */}
        <div className="space-y-4">
          <UnprolongedCommentsSection clientId={client.id} />
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Информация</CardTitle>
                <EditClientDialog
                  client={{
                    id: client.id,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    patronymic: client.patronymic,
                    phone: client.phone,
                    phone2: client.phone2,
                    email: client.email,
                    socialLink: client.socialLink,
                    branchId: client.branchId,
                    assignedTo: client.assignedTo,
                    comment: client.comment,
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ответственный</span>
                <span>{assigneeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Филиал</span>
                <span>{client.branch?.name || "—"}</span>
              </div>
              {client.phone2 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Телефон 2</span>
                  <span>{client.phone2}</span>
                </div>
              )}
              {client.email && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{client.email}</span>
                </div>
              )}
              {client.socialLink && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Соцсеть</span>
                  <span className="truncate max-w-[160px]">{client.socialLink}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Дата создания</span>
                <span>{formatDate(client.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">LTV</span>
                <span className="font-bold">
                  {moneyLtv > 0 ? formatMoney(moneyLtv) : "—"}
                  {client.monthsLtv > 0 ? ` · ${client.monthsLtv} мес.` : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сегмент</span>
                <span>
                  {client.totalSubscriptionsCount > 0
                    ? `${client.totalSubscriptionsCount} абонементов куплено`
                    : "Нет абонементов"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Дата продажи</span>
                <span>{formatDate(client.saleDate)}</span>
              </div>
              {client.comment && (
                <div>
                  <div className="text-muted-foreground mb-1">Комментарий</div>
                  <div className="rounded-md bg-muted/50 p-2 text-sm">
                    {client.comment}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
