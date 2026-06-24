import { getSession, getBranchScope } from "@/lib/session"
import { scopeClientByBranch } from "@/lib/client-segments"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Phone, Users } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CampaignItemsTable } from "./campaign-items-table"
import type { CallItem } from "./call-item-row"

const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  churned: "Выбывший",
  archived: "Архив",
}

/** Полных лет на дату `now` по дате рождения. */
function ageYears(birth: Date, now: Date): number {
  let a = now.getUTCFullYear() - birth.getUTCFullYear()
  const m = now.getUTCMonth() - birth.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) a--
  return a
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const { id } = await params

  const campaign = await db.callCampaign.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!campaign) notFound()

  // Изоляция по филиалам (RLS на проде не enforced): показываем только позиции,
  // чьи клиенты видны в scope сессии. Иначе админ с ограниченным набором филиалов
  // увидел бы в кампании владельца (по всем филиалам) чужих клиентов с ФИО и
  // телефонами (ADM-04).
  const items = await db.callCampaignItem.findMany({
    where: { campaignId: id, tenantId, client: scopeClientByBranch(scope) },
    include: {
      client: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, clientStatus: true,
          // Все подопечные (детерминированно по дате рождения) — ниже выбираем того,
          // кто попадает в возрастной фильтр кампании, чтобы возраст в таблице
          // соответствовал критерию отбора.
          wards: {
            select: { firstName: true, lastName: true, birthDate: true },
            orderBy: { birthDate: "asc" },
          },
        },
      },
    },
  })

  const now = new Date()
  const pending = items.filter(i => i.status === "pending").length
  const completed = items.filter(i => i.status !== "pending").length
  const percent = items.length > 0 ? Math.round((completed / items.length) * 100) : 0

  // Возрастной фильтр кампании (если был) — чтобы выбрать «того самого» подопечного.
  const fc = (campaign.filterCriteria ?? {}) as { minAge?: number; maxAge?: number }
  function pickWard(wards: { firstName: string; lastName: string | null; birthDate: Date | null }[]) {
    if (wards.length === 0) return null
    if (typeof fc.minAge === "number" || typeof fc.maxAge === "number") {
      const match = wards.find((w) => {
        if (!w.birthDate) return false
        const a = ageYears(w.birthDate, now)
        if (typeof fc.minAge === "number" && a < fc.minAge) return false
        if (typeof fc.maxAge === "number" && a > fc.maxAge) return false
        return true
      })
      if (match) return match
    }
    return wards[0]
  }

  // Плейсхолдер «—» рисуется при отображении (call-item-row); в данные кладём
  // пустые значения, чтобы сортировка корректно отправляла их в конец списка.
  const rows: CallItem[] = items.map(i => {
    const name = [i.client.lastName, i.client.firstName].filter(Boolean).join(" ") || "Без имени"
    const ward = pickWard(i.client.wards)
    const wardName = ward ? [ward.firstName, ward.lastName].filter(Boolean).join(" ") : ""
    const age = ward?.birthDate ? ageYears(ward.birthDate, now) : null
    return {
      id: i.id,
      clientId: i.clientId,
      clientName: name,
      phone: maskPhone(i.client.phone, session.user.role) || "",
      wardName,
      age,
      clientStatusLabel: i.client.clientStatus
        ? CLIENT_STATUS_LABELS[i.client.clientStatus] || i.client.clientStatus
        : "",
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
        <CampaignItemsTable rows={rows} campaignId={id} />
      )}
    </div>
  )
}
