import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { scopeFinancialAccount, scopeSubscription } from "@/lib/branch-scope"
import { notFound } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CreditCard, FileText, Building2, GraduationCap, User, Percent, CalendarDays } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { ClientTabs } from "../clients/[id]/client-tabs"
import { EditClientDialog } from "../clients/[id]/edit-client-dialog"
import { UnprolongedCommentsSection } from "../clients/[id]/unprolonged-comments"
import { LeadStatusActions } from "./lead-status-actions"
import { ApplicationsSection } from "./applications-section"
import { SegmentBadgeSelect } from "./segment-badge-select"
import {
  computeSegment,
  monthsSince,
  parseSegmentationConfig,
  type ClientSegmentKey,
} from "@/lib/segmentation"
import { PortalLinkButton } from "./portal-link-button"
import { ClientDiscountSelect } from "./client-discount-select"
import { EditableDateCell } from "./editable-cell"
import { BonusDiscountDialog } from "./bonus-discount-dialog"
import { QuickRenewSubscriptionDialog } from "./quick-renew-subscription-dialog"
import { CreateApplicationDialog } from "./create-application-dialog"
import { TrialLessonDialog } from "./trial-lesson-dialog"
import { AddPaymentDialog } from "../../finance/payments/add-payment-dialog"

// Сегментные подписи/цвета живут в SegmentBadgeSelect — кликабельном бейдже
// (баг #26). В шапке сегмент активного клиента редактируется вручную.

const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  churned: "Выбывший",
  archived: "Архив",
}

// Лейблы для пре-сейл стадий воронки родителя — показываем в шапке вместо
// сегмента, когда clientStatus ещё не выставлен. Сегмент «Новый» в этих
// статусах вводит в заблуждение (читается как «новый клиент»).
const FUNNEL_PRESALE_LABELS: Record<string, string> = {
  new: "Лид",
  potential: "Потенциал",
  non_target: "Нецелевой",
}

const FUNNEL_PRESALE_COLORS: Record<string, string> = {
  new: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  potential: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  non_target: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
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
  const scope = await getBranchScope()

  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      wards: true,
      branch: true,
      channel: { select: { name: true } },
      assignee: { select: { firstName: true, lastName: true } },
      discountTemplate: {
        select: { id: true, name: true, kind: true, valueType: true, value: true },
      },
    },
  })

  if (!client) notFound()

  // Маскируем телефоны для инструктора (PRD §5.4)
  const role = session.user.role
  const visiblePhone = maskPhone(client.phone, role)
  const visiblePhone2 = maskPhone(client.phone2, role)

  // Активные абонементы — то, чем ребёнок занимается прямо сейчас:
  // не отчислены админом (withdrawalDate IS NULL, status != withdrawn|closed)
  // и относятся к текущему или будущему календарному месяцу.
  // По PRD (SUB-02) абонемент привязан к одному месяцу — каждый месяц новый;
  // прошлые «незакрытые» абонементы не должны считаться актуальными.
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const activeSubscriptions = await db.subscription.findMany({
    where: {
      clientId: client.id,
      tenantId,
      deletedAt: null,
      withdrawalDate: null,
      status: { in: ["pending", "active"] },
      OR: [
        { periodYear: { gt: currentYear } },
        { periodYear: currentYear, periodMonth: { gte: currentMonth } },
      ],
    },
    include: {
      ward: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: {
        select: {
          name: true,
          branch: { select: { name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
      discounts: {
        where: { isActive: true },
        select: {
          id: true,
          type: true,
          valueType: true,
          value: true,
          calculatedAmount: true,
          linkedClientId: true,
          comment: true,
        },
      },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  })

  // Счета компании для диалога «Оплата» (только активные, в scope филиалов).
  const accounts = await db.financialAccount.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      ...scopeFinancialAccount(scope),
    },
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: "asc" },
  })

  // Имена клиентов-оснований для связанных скидок (Discount.linkedClientId
  // не имеет relation, поэтому подтягиваем отдельным запросом).
  const linkedClientIds = Array.from(
    new Set(
      activeSubscriptions
        .flatMap((s) => s.discounts.map((d) => d.linkedClientId))
        .filter((v): v is string => Boolean(v))
    )
  )
  const linkedClients = linkedClientIds.length
    ? await db.client.findMany({
        where: { id: { in: linkedClientIds }, tenantId },
        select: { id: true, firstName: true, lastName: true, patronymic: true },
      })
    : []
  const linkedClientNameById = new Map(
    linkedClients.map((c) => [
      c.id,
      [c.lastName, c.firstName, c.patronymic].filter(Boolean).join(" ") || "Без имени",
    ])
  )

  // «Долг по абонементам» в шапке = сумма столбца «К оплате» вкладки абонементов:
  // непогашенный остаток (balance > 0) по всем неотчисленным абонементам клиента.
  // Отчисление обнуляет balance, и в «К оплате» такой абонемент показывается «—»,
  // поэтому withdrawn исключаем явно (страховка от legacy-данных с balance > 0).
  // Branch-scope — тот же, что у вкладки (GET /api/subscriptions).
  const subscriptionDebtAgg = await db.subscription.aggregate({
    where: {
      tenantId,
      clientId: client.id,
      deletedAt: null,
      status: { not: "withdrawn" },
      balance: { gt: 0 },
      ...scopeSubscription(scope),
    },
    _sum: { balance: true },
  })
  const subscriptionDebt = Number(subscriptionDebtAgg._sum.balance ?? 0)

  const fullName =
    [client.lastName, client.firstName, client.patronymic]
      .filter(Boolean)
      .join(" ") || "Без имени"
  const balance = Number(client.clientBalance)
  const moneyLtv = Number(client.moneyLtv)
  const assigneeName = client.assignee
    ? [client.assignee.lastName, client.assignee.firstName].filter(Boolean).join(" ")
    : "—"

  // Дата следующей связи просрочена, если она строго раньше сегодняшнего дня
  // (сравниваем по UTC-полуночи: nextContactDate — @db.Date, хранится как 00:00 UTC).
  const todayDateOnly = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  const nextContactOverdue =
    !!client.nextContactDate && client.nextContactDate < todayDateOnly

  // Подопечные с активной подпиской выходят из воронки продаж — селектор
  // для них скрываем (см. WardSalesStageActions).
  const wardsWithActiveSub = new Set(
    activeSubscriptions
      .map((s) => s.wardId)
      .filter((id): id is string => Boolean(id))
  )
  const wardsForClient = client.wards.map((w) => ({
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    birthDate: w.birthDate?.toISOString() || null,
    salesStage: w.salesStage,
    hasActiveSubscription: wardsWithActiveSub.has(w.id),
  }))

  // Пробное доступно, если хотя бы у одного подопечного открыта заявка
  // (ward.salesStage='application' или Application(status='active')).
  const activeApplicationWardIds = new Set(
    (
      await db.application.findMany({
        where: { tenantId, clientId: client.id, status: "active", deletedAt: null },
        select: { wardId: true },
      })
    ).map((a) => a.wardId)
  )
  const canScheduleTrial = client.wards.some(
    (w) => w.salesStage === "application" || activeApplicationWardIds.has(w.id),
  )
  const trialDisabledReason = canScheduleTrial
    ? undefined
    : "Сначала создайте заявку на ребёнка"

  // Сегмент клиента: пороги владелец задаёт в /settings/segmentation.
  // Считаем лениво только для активных клиентов (для лидов сегмент не
  // показывается — бадж в шапке для них = funnel-стадия).
  let computedSegment: ClientSegmentKey = "new_client"
  if (client.clientStatus === "active") {
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { segmentationConfig: true },
    })
    const config = parseSegmentationConfig(org?.segmentationConfig)
    if (config) {
      let metric = 0
      if (config.mode === "amount") {
        const agg = await db.subscription.aggregate({
          where: { tenantId, clientId: client.id, deletedAt: null },
          _sum: { chargedAmount: true },
        })
        metric = Number(agg._sum.chargedAmount ?? 0)
      } else {
        metric = monthsSince(client.firstPaymentDate)
      }
      computedSegment = computeSegment(metric, config)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <BackButton fallbackHref={backHref} />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{fullName}</h1>
            {/* Бадж качества контакта в шапке: для активного клиента — сегмент
                (Новый/Стандарт/…); для лида/потенциала/нецелевого — стадия
                воронки («Лид»/«Потенциал»/«Нецелевой»); для выбывших/архива/ЧС
                — скрыт, рядом стоит баджик clientStatus. */}
            {client.clientStatus === "active" ? (
              <SegmentBadgeSelect
                clientId={client.id}
                override={client.segmentOverride as ClientSegmentKey | null}
                computed={computedSegment}
              />
            ) : (
              !client.clientStatus &&
              FUNNEL_PRESALE_LABELS[client.funnelStatus] && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${FUNNEL_PRESALE_COLORS[client.funnelStatus] || ""}`}
                >
                  {FUNNEL_PRESALE_LABELS[client.funnelStatus]}
                </span>
              )
            )}
            {client.clientStatus &&
              client.funnelStatus !== "archived" &&
              client.funnelStatus !== "blacklisted" && (
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{visiblePhone || "—"}</span>
            <span>·</span>
            <span>{client.email || "—"}</span>
            <span>·</span>
            <ClientDiscountSelect
              clientId={client.id}
              initialTemplateId={client.discountTemplateId ?? null}
              initialTemplate={
                client.discountTemplate
                  ? {
                      id: client.discountTemplate.id,
                      name: client.discountTemplate.name,
                      valueType: client.discountTemplate.valueType,
                      value: Number(client.discountTemplate.value),
                    }
                  : null
              }
              hasType1Discount={activeSubscriptions.some(
                (s) => s.discountSource === "type1",
              )}
            />
          </div>
        </div>
        <div className="text-right">
          <div className="flex h-7 items-center justify-end">
            <div className="text-sm text-muted-foreground">Долг по абонементам</div>
          </div>
          <div
            className={`text-2xl font-bold ${
              subscriptionDebt > 0 ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {subscriptionDebt > 0 ? formatMoney(subscriptionDebt) : "0 ₽"}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <div className="text-sm text-muted-foreground">Баланс</div>
            <BonusDiscountDialog
              clientId={client.id}
              defaultResponsibleId={session.user.employeeId ?? null}
            />
          </div>
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
      <div className="flex flex-wrap items-center gap-2">
        {client.funnelStatus !== "archived" && client.funnelStatus !== "blacklisted" && (
          <>
            {/* «+ Абонемент» — продление текущего активного абонемента на следующий период.
                Для нового направления/группы — кнопка «+ Заявка». */}
            <QuickRenewSubscriptionDialog
              subscriptions={activeSubscriptions
                .filter((s) => s.type === "calendar")
                .map((s) => ({
                  id: s.id,
                  directionName: s.direction.name,
                  groupName: s.group.name,
                  branchName: s.group.branch?.name ?? null,
                  wardId: s.wardId,
                  wardName: s.ward
                    ? [s.ward.lastName, s.ward.firstName].filter(Boolean).join(" ").trim() ||
                      s.ward.firstName
                    : null,
                  wardFirstName: s.ward?.firstName ?? null,
                  wardLastName: s.ward?.lastName ?? null,
                  lessonPrice: Number(s.lessonPrice),
                  periodYear: s.periodYear,
                  periodMonth: s.periodMonth,
                }))}
            />
            <CreateApplicationDialog
              clientId={client.id}
              wards={client.wards.map((w) => ({
                id: w.id,
                firstName: w.firstName,
                lastName: w.lastName,
              }))}
              triggerLabel="Заявка"
            />
            <TrialLessonDialog
              clientId={client.id}
              wards={client.wards.map((w) => ({
                id: w.id,
                firstName: w.firstName,
                lastName: w.lastName,
              }))}
              disabledReason={trialDisabledReason}
            />
            {/* «Оплата» доступна и лиду: первая оплата — это и есть конверсия
                лид → клиент (PRD: переход автоматический при первой оплате).
                Баг #77 — раньше кнопка пряталась под client.clientStatus. */}
            <AddPaymentDialog
              clients={[]}
              incomeCategories={[]}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
              lockedClient={{
                id: client.id,
                name:
                  [client.lastName, client.firstName].filter(Boolean).join(" ") ||
                  "Без имени",
              }}
              triggerButton={
                <Button>
                  <CreditCard className="mr-2 size-4" />
                  Оплата
                </Button>
              }
            />
            {/* Личный кабинет — для тех, кто уже клиент (есть clientStatus). */}
            {client.clientStatus && <PortalLinkButton clientId={client.id} />}
          </>
        )}
        <LeadStatusActions
          clientId={client.id}
          currentStatus={client.funnelStatus}
          clientStatus={client.clientStatus}
          isActiveClient={
            activeSubscriptions.length > 0 ||
            client.clientStatus === "active"
          }
        />
      </div>

      {/* Активные абонементы — то, чем ребёнок занимается прямо сейчас */}
      {activeSubscriptions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="size-4 text-muted-foreground" />
              Активные занятия
              <Badge variant="secondary" className="ml-1 font-normal">
                {activeSubscriptions.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {activeSubscriptions.map((s) => {
              const branch = s.group.branch?.name || "—"
              const dir = s.direction.name
              const group = s.group.name
              const instr = s.group.instructor
                ? [s.group.instructor.lastName, s.group.instructor.firstName]
                    .filter(Boolean)
                    .join(" ")
                : "—"
              const wardName = s.ward
                ? [s.ward.lastName, s.ward.firstName].filter(Boolean).join(" ")
                : null
              return (
                <div
                  key={s.id}
                  className="rounded-lg border bg-card p-3 text-sm space-y-2"
                >
                  {/* Филиал → Направление → Группа */}
                  <div className="flex items-center gap-1.5 font-medium leading-snug">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">{branch}</span>
                    <span className="text-muted-foreground">›</span>
                    <span>{dir}</span>
                    <span className="text-muted-foreground">›</span>
                    <span className="text-muted-foreground">{group}</span>
                  </div>
                  {wardName && (
                    <div className="text-xs text-muted-foreground">
                      Подопечный: <span className="text-foreground">{wardName}</span>
                    </div>
                  )}
                  <div className="grid gap-1 text-xs sm:grid-cols-2">
                    <div className="flex items-center gap-1.5">
                      <User className="size-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Педагог:</span>
                      <span>{instr}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="size-3 text-muted-foreground" />
                      <span className="text-muted-foreground">С:</span>
                      <span>{formatDate(s.startDate)}</span>
                    </div>
                  </div>
                  {s.discounts.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      {s.discounts.map((d) => {
                        const valueLabel =
                          d.valueType === "percent"
                            ? `${Number(d.value)}%`
                            : `−${formatMoney(Number(d.value))}/занятие`
                        const calcLabel =
                          Number(d.calculatedAmount) > 0
                            ? ` (−${formatMoney(Number(d.calculatedAmount))})`
                            : ""
                        const typeLabel =
                          d.type === "second_subscription"
                            ? "За 2-й абонемент (авто)"
                            : d.type === "linked"
                              ? "Связанная"
                              : d.type === "permanent"
                                ? "Постоянная"
                                : "Разовая"
                        const linkedName = d.linkedClientId
                          ? linkedClientNameById.get(d.linkedClientId)
                          : null
                        return (
                          <div
                            key={d.id}
                            className="flex items-start gap-1.5 text-xs"
                          >
                            <Percent className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                            <div className="flex-1">
                              <span className="font-medium">{typeLabel}</span>
                              <span className="text-muted-foreground">
                                {" "}— {valueLabel}
                                {calcLabel}
                              </span>
                              {linkedName && (
                                <div className="text-muted-foreground">
                                  Связана с:{" "}
                                  <span className="text-foreground">
                                    {linkedName}
                                  </span>
                                </div>
                              )}
                              {d.comment && !linkedName && (
                                <div className="text-muted-foreground">
                                  {d.comment}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Заявки */}
      <ApplicationsSection
        clientId={client.id}
        canDelete={session.user.role === "owner" || session.user.role === "manager"}
      />

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Main content: tabs */}
        <div className="min-w-0">
          <ClientTabs clientId={client.id} wards={wardsForClient} />
        </div>

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
                    phone: visiblePhone,
                    phone2: visiblePhone2,
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
              {/* Дата следующей связи — редактируется инлайн. По наступлении даты
                  автотриггер «contact_date» создаёт задачу «Позвонить» (см.
                  lib/tasks/generate-tasks). Просроченную дату подсвечиваем красным. */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={
                    nextContactOverdue
                      ? "font-medium text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  Дата следующей связи
                </span>
                <EditableDateCell
                  initialValue={
                    client.nextContactDate
                      ? client.nextContactDate.toISOString().slice(0, 10)
                      : ""
                  }
                  endpoint={{
                    url: `/api/clients/${client.id}`,
                    field: "nextContactDate",
                  }}
                  className="h-8 w-[150px] text-xs"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ответственный</span>
                <span>{assigneeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Филиал</span>
                <span>{client.branch?.name || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Канал привлечения</span>
                <span>{client.channel?.name || "—"}</span>
              </div>
              {visiblePhone2 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Телефон 2</span>
                  <span>{visiblePhone2}</span>
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
              {/* Сегмент показан кликабельным бейджем в шапке (баг #26); здесь —
                  справочно число купленных абонементов, чтобы не путать с ним. */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Куплено абонементов</span>
                <span>{client.totalSubscriptionsCount}</span>
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
