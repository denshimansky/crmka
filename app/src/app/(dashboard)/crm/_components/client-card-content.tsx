import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { balanceDebtBreakdownByClient, balanceDebtLabels } from "@/lib/one-off-debt"
import { getRoleNames, getOrgUiSettings } from "@/lib/role-names"
import { currencySymbol } from "@/lib/currency"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { hasPermission, type RolePermissions } from "@/lib/permissions"
import { scopeBookableAccount, scopeSubscription, isUnscoped } from "@/lib/branch-scope"
import { notFound } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CreditCard, FileText, Building2, GraduationCap, User, Percent, CalendarDays } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { PageHelp } from "@/components/page-help"
import { ClientTabs } from "../clients/[id]/client-tabs"
import { EditClientDialog } from "../clients/[id]/edit-client-dialog"
import { UnprolongedCommentsSection } from "../clients/[id]/unprolonged-comments"
import { LeadStatusActions } from "./lead-status-actions"
import { wasEverClient } from "@/lib/clients/was-ever-client"
import { ApplicationsSection } from "./applications-section"
import { SegmentBadgeSelect } from "./segment-badge-select"
import {
  computeSegment,
  monthsSince,
  parseSegmentationConfig,
  type ClientSegmentKey,
} from "@/lib/segmentation"
import { PortalAccountButton } from "./portal-account-button"
import { discountLabel } from "./discount-label"
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
  const roleNames = await getRoleNames(tenantId)
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  // Формат числа сохраняем прежним (ru-RU, без округления/копеек, как было);
  // меняется только символ валюты организации.
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat("ru-RU").format(amount) + " " + currencySymbol(currency)

  // Блок «Непродлённые абонементы» — только для пакетной модели. У пакета нет
  // «месяца периода», непродление ловится по истечению срока, и страница-отчёт
  // /reports/churn/not-renewed для такой организации показывает пусто — карточка
  // остаётся единственным местом, где эта картина видна. Календарной организации
  // блок не нужен: там работает сам отчёт.
  const orgSubType = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackageOrg = orgSubType?.subscriptionType === "package"

  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      wards: true,
      branch: true,
      secondBranch: true,
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
  const visiblePhone = maskPhone(client.phone, role, session.user.instructorsSeePhones)
  const visiblePhone2 = maskPhone(client.phone2, role, session.user.instructorsSeePhones)

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
          branchId: true,
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

  // Источники для диалога «Абонемент» (точечное продление): активные ПЛЮС
  // закрытые за прошлый/текущий месяц — автозакрытие отработанных идёт
  // ежедневно, и у клиента, выписываемого после 1-го числа, прошлый месяц уже
  // closed; продление с него легитимно (renew-роут не даст выписать в прошлое).
  // Отдельный запрос, чтобы не трогать activeSubscriptions (бейджи, вкладка).
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1
  const renewableClosedSubs = await db.subscription.findMany({
    where: {
      clientId: client.id,
      tenantId,
      deletedAt: null,
      withdrawalDate: null,
      scheduledWithdrawalDate: null,
      type: "calendar",
      status: "closed",
      OR: [
        { periodYear: currentYear, periodMonth: currentMonth },
        { periodYear: prevYear, periodMonth: prevMonth },
      ],
    },
    include: {
      ward: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: { select: { name: true, branchId: true, branch: { select: { name: true } } } },
    },
    orderBy: [{ startDate: "desc" }],
  })
  // Дедуп по (подопечный, направление, группа) с приоритетом активных —
  // зеркалит loadSources в bulk-renew.
  const renewSourceByKey = new Map<
    string,
    {
      id: string
      wardId: string | null
      ward: { firstName: string; lastName: string | null } | null
      direction: { name: string }
      group: { name: string; branchId: string; branch: { name: string } | null }
      lessonPrice: unknown
      periodYear: number | null
      periodMonth: number | null
    }
  >()
  for (const s of [
    ...activeSubscriptions.filter((s) => s.type === "calendar"),
    ...renewableClosedSubs,
  ]) {
    const k = `${s.wardId ?? ""}|${s.directionId}|${s.groupId}`
    if (!renewSourceByKey.has(k)) renewSourceByKey.set(k, s)
  }
  // ADM-04: не предлагаем продлить абонемент чужого филиала — роут
  // /api/subscriptions/[id]/renew такой запрос всё равно отклонит (403).
  const allRenewSources = [...renewSourceByKey.values()]
  const renewSources = allRenewSources.filter(
    (s) => isUnscoped(scope) || scope.branchIds.includes(s.group.branchId),
  )
  // Сколько отсеяли по филиалу — чтобы подсказка у выключённой кнопки
  // «Продление абонемента» объясняла причину, а не отрицала наличие абонементов.
  const renewOutOfScopeCount = allRenewSources.length - renewSources.length

  // Счета компании для диалога «Оплата» — «на что можно провести оплату»:
  // общий счёт остаётся выбираемым (админ может записать безнал клиента),
  // хотя его баланс на «Кассе» скрыт (scopeBookableAccount, 23.07.2026).
  const accounts = await db.financialAccount.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      ...scopeBookableAccount(scope),
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

  // Долг по балансу: минусовой clientBalance — не входит в «Долг по абонементам»,
  // показываем отдельной строкой со знаком «−» (это долг клиента) и раскладкой по
  // источникам: разовые посещения / долг после импорта / перенос-закрытие.
  const balanceDebt = Math.max(0, -Number(client.clientBalance))
  const balanceDebtParts =
    balanceDebt > 0
      ? balanceDebtLabels(
          (
            await balanceDebtBreakdownByClient(tenantId, [
              { id: client.id, clientBalance: client.clientBalance },
            ])
          ).get(client.id) ?? { oneOff: 0, imported: 0, other: balanceDebt },
        )
      : []

  const fullName =
    [client.lastName, client.firstName, client.patronymic]
      .filter(Boolean)
      .join(" ") || "Без имени"
  const balance = Number(client.clientBalance)
  const moneyLtv = Number(client.moneyLtv)

  // Кнопка «Удалить клиента» в диалоге редактирования: право clients.delete
  // (по умолчанию только владелец) + гейт нулевого баланса. Удалять можно ТОЛЬКО
  // клиента без долгов и переплат — иначе кнопка задизейблена с причиной, а API
  // всё равно откажет (двойная проверка).
  // Владельцу право всегда true — матрицу не читаем (лишний SELECT). Остальным
  // ролям нужна org.rolePermissions, чтобы учесть выданное владельцем право.
  const orgPerms =
    role === "owner"
      ? null
      : await db.organization.findUnique({
          where: { id: tenantId },
          select: { rolePermissions: true },
        })
  const canDeleteClient = hasPermission(
    role,
    "clients.delete",
    orgPerms?.rolePermissions as RolePermissions | null,
  )
  const subsWithBalanceCount = canDeleteClient
    ? await db.subscription.count({
        where: { tenantId, clientId: client.id, deletedAt: null, balance: { not: 0 } },
      })
    : 0
  const deleteBlockReason = !canDeleteClient
    ? null
    : balance !== 0
      ? "Удаление доступно только при нулевом балансе — сейчас есть долг или переплата."
      : subsWithBalanceCount > 0
        ? "Есть абонементы с незакрытым балансом — удаление недоступно."
        : null
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackButton fallbackHref={backHref} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
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
            <PageHelp pageKey="crm/clients/[id]" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{visiblePhone || "—"}</span>
            <span>·</span>
            <span>{client.email || "—"}</span>
            <span>·</span>
            {/* Скидка — информационно (эффективная, не название настройки).
                Выбор перенесён в «Редактировать клиента». */}
            <span title="Скидка">
              {discountLabel({
                autoDiscountDisabled: client.autoDiscountDisabled,
                perSubDiscountMode: client.perSubDiscountMode,
                templateId: client.discountTemplateId,
                template: client.discountTemplate
                  ? {
                      name: client.discountTemplate.name,
                      valueType: client.discountTemplate.valueType,
                      value: Number(client.discountTemplate.value),
                    }
                  : null,
                hasType1Discount: activeSubscriptions.some(
                  (s) => s.discountSource === "type1",
                ),
              }, currencySymbol(currency))}
            </span>
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
            {subscriptionDebt > 0 ? formatMoney(subscriptionDebt) : `0 ${currencySymbol(currency)}`}
          </div>
          {balanceDebt > 0 && (
            <div className="text-xs text-red-600">
              − {formatMoney(balanceDebt)} по балансу
              {balanceDebtParts.length > 0 && ` (${balanceDebtParts.join(", ")})`}
            </div>
          )}
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
            {balance === 0 ? `0 ${currencySymbol(currency)}` : formatMoney(balance)}
          </div>
        </div>
      </div>

      {/* Action buttons / Lead actions */}
      <div className="flex flex-wrap items-center gap-2">
        {client.funnelStatus !== "archived" && client.funnelStatus !== "blacklisted" && (
          <>
            {/* «+ Абонемент» — продление текущего активного ИЛИ закрытого за
                прошлый/текущий месяц абонемента на следующий период.
                Для нового направления/группы — кнопка «+ Заявка». */}
            <QuickRenewSubscriptionDialog
              outOfScopeCount={renewOutOfScopeCount}
              subscriptions={renewSources
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
            {/* «Оплата» доступна и лиду: он может внести деньги на баланс
                заранее. В клиента переводит не пополнение баланса, а оплата
                абонемента (на любую сумму) или первое платное занятие.
                Баг #77 — раньше кнопка пряталась под client.clientStatus. */}
            <AddPaymentDialog
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
            {client.clientStatus && <PortalAccountButton clientId={client.id} />}
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
          wasEverClient={wasEverClient({
            firstPaymentDate: client.firstPaymentDate,
            firstPaidLessonDate: client.firstPaidLessonDate,
            clientStatus: client.clientStatus,
          })}
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
                      <span className="text-muted-foreground">{roleNames.instructor}:</span>
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
      <ApplicationsSection clientId={client.id} />

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Main content: tabs */}
        <div className="min-w-0">
          <ClientTabs clientId={client.id} wards={wardsForClient} perSubDiscountMode={client.perSubDiscountMode} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {isPackageOrg && <UnprolongedCommentsSection clientId={client.id} />}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Информация</CardTitle>
                <EditClientDialog
                  canDelete={canDeleteClient}
                  deleteBlockReason={deleteBlockReason}
                  client={{
                    id: client.id,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    patronymic: client.patronymic,
                    phone: visiblePhone,
                    phone2: visiblePhone2,
                    email: client.email,
                    socialLink: client.socialLink,
                    telegram: client.telegram,
                    vk: client.vk,
                    max: client.max,
                    channelId: client.channelId,
                    branchId: client.branchId,
                    secondBranchId: client.secondBranchId,
                    assignedTo: client.assignedTo,
                    comment: client.comment,
                    discountTemplateId: client.discountTemplateId,
                    autoDiscountDisabled: client.autoDiscountDisabled,
                    perSubDiscountMode: client.perSubDiscountMode,
                    discountTemplate: client.discountTemplate
                      ? {
                          name: client.discountTemplate.name,
                          valueType: client.discountTemplate.valueType,
                          value: Number(client.discountTemplate.value),
                        }
                      : null,
                    hasType1Discount: activeSubscriptions.some(
                      (s) => s.discountSource === "type1",
                    ),
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
                      ? "font-medium text-destructive shrink-0"
                      : "text-muted-foreground shrink-0"
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
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Ответственный</span>
                <span className="text-right">{assigneeName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Филиал</span>
                <span className="text-right">{client.branch?.name || "—"}</span>
              </div>
              {client.secondBranch && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Второй филиал</span>
                  <span className="text-right">{client.secondBranch.name}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">
                  Канал привлечения
                </span>
                <span className="text-right">{client.channel?.name || "—"}</span>
              </div>
              {visiblePhone2 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Телефон 2</span>
                  <span className="text-right">{visiblePhone2}</span>
                </div>
              )}
              {client.email && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Email</span>
                  <span className="text-right break-all">{client.email}</span>
                </div>
              )}
              {client.socialLink && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Соцсеть</span>
                  <span className="truncate max-w-[160px] text-right">
                    {client.socialLink}
                  </span>
                </div>
              )}
              {client.telegram && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Телеграм</span>
                  <span className="truncate max-w-[160px] text-right">
                    {client.telegram}
                  </span>
                </div>
              )}
              {client.vk && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">ВК</span>
                  <span className="truncate max-w-[160px] text-right">
                    {client.vk}
                  </span>
                </div>
              )}
              {client.max && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">MAX</span>
                  <span className="truncate max-w-[160px] text-right">
                    {client.max}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Дата создания</span>
                <span className="text-right">{formatDate(client.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">LTV</span>
                <span className="font-bold text-right">
                  {moneyLtv > 0 ? formatMoney(moneyLtv) : "—"}
                  {client.monthsLtv > 0 ? ` · ${client.monthsLtv} мес.` : ""}
                </span>
              </div>
              {/* Сегмент показан кликабельным бейджем в шапке (баг #26); здесь —
                  справочно число купленных абонементов, чтобы не путать с ним. */}
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">
                  Куплено абонементов
                </span>
                <span className="text-right">{client.totalSubscriptionsCount}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Дата продажи</span>
                <span className="text-right">{formatDate(client.saleDate)}</span>
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
