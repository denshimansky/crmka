import { getSession, getBranchScope } from "@/lib/session"
import { scopeClientByBranch } from "@/lib/client-segments"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Archive, ArrowLeft, FilePlus, PhoneCall, PhoneOff, Users, XCircle } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { notFound } from "next/navigation"
import { CampaignItemsTable } from "./campaign-items-table"
import type { CallItem } from "./call-item-row"
import { RefreshCampaignButton } from "./refresh-campaign-button"
import { CampaignStatCards } from "../campaign-stat-cards"
import { PageHelp } from "@/components/page-help"
import { clientStateLabel } from "@/lib/clients/state-label"
import { formatAge } from "@/lib/age"

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
          id: true, firstName: true, lastName: true, phone: true,
          funnelStatus: true, clientStatus: true,
          // Все подопечные (детерминированно по дате рождения) — ниже выбираем того,
          // кто попадает в возрастной фильтр кампании, чтобы возраст в таблице
          // соответствовал критерию отбора.
          wards: {
            select: { id: true, firstName: true, lastName: true, birthDate: true },
            orderBy: { birthDate: "asc" },
          },
        },
      },
    },
  })

  // Имена ответственных (кто зафиксировал результат) — по CallCampaignItem.calledBy.
  const responsibleIds = [
    ...new Set(items.map((i) => i.calledBy).filter((v): v is string => !!v)),
  ]
  const employees = responsibleIds.length
    ? await db.employee.findMany({
        where: { id: { in: responsibleIds }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const employeeName = new Map(
    employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ").trim()]),
  )

  // Архивная кампания доступна только для просмотра: кнопка «Результат» у
  // контактов становится неактивной (фиксировать результаты звонков нельзя).
  const readOnly = campaign.status === "archived"

  const now = new Date()
  const completed = items.filter(i => i.status !== "pending").length
  const percent = items.length > 0 ? Math.round((completed / items.length) * 100) : 0

  // «Сегодня» по московскому времени (бизнес-стандарт РФ): контейнер живёт в UTC,
  // поэтому дату фиксации результата (calledAt) сравниваем в TZ Europe/Moscow —
  // иначе у звонков около полуночи «сегодня» уезжает на 3 часа.
  const mskDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" })
  const todayMsk = mskDay(now)
  const isToday = (d: Date | null) => !!d && mskDay(d) === todayMsk

  // Пять карточек-показателей (Аня): «Всего контактов» + 4 исхода обзвона.
  // В каждой — крупное число ВСЕГО по кампании и мелкое «за сегодня».
  // «Создано заявок» считаем по result="application" (кнопка «Создать заявку»);
  // остальные — по статусу позиции. Заявка ставит статус "called", поэтому исходы
  // «Отказ/Перезвонить/Не ответил» с ней не пересекаются.
  const cardStats = [
    {
      key: "total",
      label: "Всего контактов",
      total: items.length,
      today: items.filter((i) => isToday(i.calledAt)).length,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      key: "apps",
      label: "Создано заявок",
      total: items.filter((i) => i.result === "application").length,
      today: items.filter((i) => i.result === "application" && isToday(i.calledAt)).length,
      icon: FilePlus,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      key: "refused",
      label: "Отказ",
      total: items.filter((i) => i.status === "completed").length,
      today: items.filter((i) => i.status === "completed" && isToday(i.calledAt)).length,
      icon: XCircle,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      key: "callback",
      label: "Перезвонить",
      total: items.filter((i) => i.status === "callback").length,
      today: items.filter((i) => i.status === "callback" && isToday(i.calledAt)).length,
      icon: PhoneCall,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      key: "noanswer",
      label: "Не ответил",
      total: items.filter((i) => i.status === "no_answer").length,
      today: items.filter((i) => i.status === "no_answer" && isToday(i.calledAt)).length,
      icon: PhoneOff,
      color: "text-slate-600",
      bg: "bg-slate-100",
    },
  ]

  // Возрастной фильтр кампании (если был) — чтобы выбрать «того самого» подопечного.
  const fc = (campaign.filterCriteria ?? {}) as {
    minAge?: number
    maxAge?: number
    birthFrom?: string
    birthTo?: string
  }
  // Границы диапазона даты рождения из критериев: новый фильтр (birthFrom/birthTo,
  // мс от эпохи) — иначе конвертируем legacy-возраст.
  const birthLoMs = fc.birthFrom ? Date.parse(`${fc.birthFrom}T00:00:00.000Z`) : null
  const birthHiMs = fc.birthTo ? Date.parse(`${fc.birthTo}T00:00:00.000Z`) : null
  const hasWardFilter =
    birthLoMs != null || birthHiMs != null ||
    typeof fc.minAge === "number" || typeof fc.maxAge === "number"

  function wardMatches(w: { birthDate: Date | null }): boolean {
    if (!w.birthDate) return false
    // Новый фильтр — прямой диапазон даты рождения (включительно по дню).
    if (birthLoMs != null || birthHiMs != null) {
      const t = w.birthDate.getTime()
      if (birthLoMs != null && t < birthLoMs) return false
      if (birthHiMs != null && t > birthHiMs) return false
      return true
    }
    // Legacy — возраст.
    const a = ageYears(w.birthDate, now)
    if (typeof fc.minAge === "number" && a < fc.minAge) return false
    if (typeof fc.maxAge === "number" && a > fc.maxAge) return false
    return true
  }

  function pickWard(wards: { firstName: string; lastName: string | null; birthDate: Date | null }[]) {
    if (wards.length === 0) return null
    if (hasWardFilter) {
      const match = wards.find(wardMatches)
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
    // Метка возраста с месяцами («5 лет 3 мес.») — для отображения; `age` (целые
    // годы) остаётся для сортировки колонки.
    const ageLabel = ward?.birthDate ? formatAge(ward.birthDate, now) : null
    return {
      id: i.id,
      clientId: i.clientId,
      clientName: name,
      phone: maskPhone(i.client.phone, session.user.role, session.user.instructorsSeePhones) || "",
      wardName,
      age,
      ageLabel,
      // «Статус клиента» — композитная метка (funnelStatus + clientStatus), как
      // в разделе «Клиенты». Раньше читался только clientStatus, который NULL у
      // потенциала/лидов/архива/ЧС/нецелевых → колонка была пустой (баг #84).
      clientStatusLabel: clientStateLabel(i.client.funnelStatus, i.client.clientStatus),
      status: i.status,
      comment: i.comment,
      result: i.result,
      // Дата обработки (когда зафиксировали результат) и ответственный. ISO —
      // чтобы сортировка в таблице шла хронологически; формат — при отображении.
      processedAt: i.calledAt ? i.calledAt.toISOString() : null,
      responsibleName: i.calledBy ? (employeeName.get(i.calledBy) ?? "") : "",
      wards: i.client.wards.map((w) => ({ id: w.id, firstName: w.firstName, lastName: w.lastName })),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton fallbackHref="/crm/calls" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <PageHelp pageKey="crm/calls/[id]" />
          </div>
          <p className="text-sm text-muted-foreground">
            Создана {campaign.createdAt.toLocaleDateString("ru-RU")}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {campaign.status === "active" && <RefreshCampaignButton campaignId={id} />}
          <Badge variant={campaign.status === "active" ? "default" : "secondary"}>
            {campaign.status === "active" ? "Активная" : campaign.status === "closed" ? "Закрыта" : "Архивный"}
          </Badge>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Archive className="size-4 shrink-0" />
          <span>Кампания в архиве — доступна только для просмотра. Кнопка «Результат» неактивна, зафиксировать звонок нельзя.</span>
        </div>
      )}

      {/* Показатели: ряд 1 — всего по кампании, ряд 2 — те же за сегодня (Аня) */}
      <CampaignStatCards stats={cardStats} />

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
        <CampaignItemsTable rows={rows} campaignId={id} readOnly={readOnly} />
      )}
    </div>
  )
}
