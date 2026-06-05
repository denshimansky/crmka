import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma, WardSalesStage } from "@prisma/client"
import { PageHelp } from "@/components/page-help"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { SalesTabs, type SalesTab } from "./sales-tabs"
import { SalesTable, type SalesRow, type SalesTabKey } from "./sales-table"
import { scopeBranch, type BranchScope, isUnscoped } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

const TAB_LABELS: Record<SalesTabKey, string> = {
  application: "Заявка",
  trial: "Пробное",
  trial_done: "Прошёл пробное",
  awaiting_payment: "Ожидаем оплату",
}
const TAB_ORDER: SalesTabKey[] = ["application", "trial", "trial_done", "awaiting_payment"]

const TAB_TO_STAGE: Record<Exclude<SalesTabKey, "application">, WardSalesStage> = {
  trial: "trial_scheduled",
  trial_done: "trial_attended",
  awaiting_payment: "awaiting_payment",
}

// Фильтр родителя для всех вкладок «Продаж»: исключаем только архив и ЧС.
// Любой другой funnelStatus (включая active_client — родитель уже платил по другому ребёнку)
// допустим, потому что воронка теперь живёт на Ward, а не на Client.
function notArchivedClient(scope: BranchScope): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = {
    deletedAt: null,
    funnelStatus: { notIn: ["archived", "blacklisted"] },
  }
  // ADM-04: сегментный scope клиента (по родителю).
  const segmentScope = scopeClientByBranch(scope)
  if (Object.keys(segmentScope).length > 0) {
    return { AND: [base, segmentScope] }
  }
  return base
}

function wardSalesWhere(
  tenantId: string,
  stage: WardSalesStage,
  scope: BranchScope,
): Prisma.WardWhereInput {
  return {
    tenantId,
    salesStage: stage,
    client: notArchivedClient(scope),
  }
}

// Фильтр пробного занятия по филиалу + направлению. Возвращает {} если оба пусты.
// AND нужен, когда заданы оба фильтра — без него Prisma переписала бы вторую OR
// поверх первой.
function trialFilter(
  branchFilter: string | null,
  directionFilter: string | null,
): Prisma.TrialLessonWhereInput {
  const groups: Prisma.TrialLessonWhereInput[] = []
  if (branchFilter) {
    groups.push({
      OR: [
        { group: { branchId: branchFilter } },
        { room: { branchId: branchFilter } },
      ],
    })
  }
  if (directionFilter) {
    groups.push({
      OR: [
        { directionId: directionFilter },
        { group: { directionId: directionFilter } },
      ],
    })
  }
  if (groups.length === 0) return {}
  if (groups.length === 1) return groups[0]
  return { AND: groups }
}

// Сужает Ward по фильтрам бранч+направление с учётом текущей стадии.
// На application — фильтр идёт по active Application; на trial-стадиях — по TrialLesson.
function wardSalesWhereWithFilters(
  tenantId: string,
  stage: WardSalesStage,
  branchFilter: string | null,
  directionFilter: string | null,
  scope: BranchScope,
): Prisma.WardWhereInput {
  const base = wardSalesWhere(tenantId, stage, scope)
  if (!branchFilter && !directionFilter) return base

  if (stage === "application") {
    return {
      ...base,
      applications: {
        some: {
          status: "active",
          deletedAt: null,
          ...(branchFilter ? { branchId: branchFilter } : {}),
          ...(directionFilter ? { directionId: directionFilter } : {}),
        },
      },
    }
  }

  const tlStatus: Prisma.TrialLessonWhereInput =
    stage === "trial_scheduled"
      ? { status: "scheduled" }
      : { status: { in: ["attended", "scheduled"] } }

  return {
    ...base,
    trialLessons: {
      some: { ...tlStatus, ...trialFilter(branchFilter, directionFilter) },
    },
  }
}

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; branchId?: string; directionId?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const role = session.user.role
  const scope = await getBranchScope()
  const { tab: rawTab, branchId: rawBranchId, directionId: rawDirectionId } =
    await searchParams
  const tab: SalesTabKey = TAB_ORDER.includes(rawTab as SalesTabKey)
    ? (rawTab as SalesTabKey)
    : "application"
  // ADM-04: пересечение явного фильтра по филиалу из URL и серверного scope.
  const rawBranch = rawBranchId && rawBranchId !== "all" ? rawBranchId : null
  const branchFilter =
    rawBranch && (isUnscoped(scope) || scope.branchIds.includes(rawBranch))
      ? rawBranch
      : null
  const directionFilter =
    rawDirectionId && rawDirectionId !== "all" ? rawDirectionId : null

  const [
    branches,
    directions,
    employees,
    countApplication,
    countTrial,
    countTrialDone,
    countAwaitingPayment,
  ] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, role: { not: "readonly" } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    // Счётчики во ВСЕХ табах учитывают активные фильтры (баг #46): по филиалу и
    // направлению — пользователь видит, сколько контактов в каждой стадии после
    // применения фильтра. Для «trial» считаем пробные (а не подопечных) — один
    // ребёнок с 2 пробными даст 2, чтобы число совпадало со списком (баг #49).
    db.ward.count({
      where: wardSalesWhereWithFilters(tenantId, "application", branchFilter, directionFilter, scope),
    }),
    db.trialLesson.count({
      where: {
        tenantId,
        status: "scheduled",
        ward: { salesStage: "trial_scheduled" },
        client: notArchivedClient(scope),
        ...trialFilter(branchFilter, directionFilter),
      },
    }),
    db.ward.count({
      where: wardSalesWhereWithFilters(tenantId, "trial_attended", branchFilter, directionFilter, scope),
    }),
    db.ward.count({
      where: wardSalesWhereWithFilters(tenantId, "awaiting_payment", branchFilter, directionFilter, scope),
    }),
  ])

  const counts: Record<SalesTabKey, number> = {
    application: countApplication,
    trial: countTrial,
    trial_done: countTrialDone,
    awaiting_payment: countAwaitingPayment,
  }

  let rows: SalesRow[] = []

  if (tab === "application") {
    // Источник вкладки «Заявка» — Ward.salesStage='application', как и у других
    // вкладок. Это: (а) включает свежесозданных подопечных без Application
    // (новые клиенты с +); (б) переживает ручной возврат в «Заявку» из ПКМ-меню,
    // даже если у подопечного никогда не было Application. Activной Application
    // (если есть) даёт филиал/направление и applicationId для «Обработать заявку».
    const wards = await db.ward.findMany({
      where: wardSalesWhereWithFilters(tenantId, "application", branchFilter, directionFilter, scope),
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            socialLink: true,
            comment: true,
            nextContactDate: true,
            assignedTo: true,
            createdAt: true,
            firstPaidLessonDate: true,
            branch: { select: { id: true, name: true } },
            channel: { select: { id: true, name: true } },
            _count: { select: { payments: true } },
          },
        },
        applications: {
          where: { status: "active", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { salesStageAt: "desc" },
    })
    rows = wards.map((w) => {
      const app = w.applications[0]
      return {
        rowId: app?.id ?? w.id,
        applicationId: app?.id,
        clientId: w.client.id,
        state: w.client._count.payments > 0 ? "client" : "lead",
        firstName: w.client.firstName,
        lastName: w.client.lastName,
        phone: maskPhone(w.client.phone, role),
        socialLink: w.client.socialLink,
        channelName: w.client.channel?.name ?? null,
        ward: { id: w.id, firstName: w.firstName, lastName: w.lastName },
        branchId: app?.branch?.id ?? w.client.branch?.id ?? null,
        branchName: app?.branch?.name ?? w.client.branch?.name ?? null,
        directionId: app?.direction?.id ?? null,
        directionName: app?.direction?.name ?? null,
        groupId: null,
        groupOrTimeLabel: null,
        scheduledDate: null,
        startTime: null,
        lessonId: null,
        firstPaidLessonDate: w.client.firstPaidLessonDate ? w.client.firstPaidLessonDate.toISOString() : null,
        expectedSubscriptionAmount: null,
        createdAt: app
          ? app.createdAt.toISOString()
          : w.salesStageAt
            ? w.salesStageAt.toISOString()
            : null,
        nextContactDate: w.client.nextContactDate ? w.client.nextContactDate.toISOString() : null,
        comment: app?.comment ?? null,
        assignedTo: w.client.assignedTo,
      }
    })
  } else if (tab === "trial") {
    // Один TrialLesson (status='scheduled') = одна строка. У одного ребёнка
    // может быть несколько запланированных пробных — каждый показываем отдельно
    // (баг #49). Фильтр по Ward.salesStage='trial_scheduled' оставляем, чтобы
    // показывать только тех детей, для кого пробное реально на повестке.
    const trials = await db.trialLesson.findMany({
      where: {
        tenantId,
        status: "scheduled",
        ward: { salesStage: "trial_scheduled" },
        client: notArchivedClient(scope),
        ...trialFilter(branchFilter, directionFilter),
      },
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            socialLink: true,
            comment: true,
            nextContactDate: true,
            assignedTo: true,
            firstPaidLessonDate: true,
            branch: { select: { id: true, name: true } },
            channel: { select: { id: true, name: true } },
            _count: { select: { payments: true } },
          },
        },
        ward: { select: { id: true, firstName: true, lastName: true } },
        group: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true, lessonPrice: true } },
          },
        },
        direction: { select: { id: true, name: true, lessonPrice: true } },
        room: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
          },
        },
        lesson: { select: { startTime: true } },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    })

    // Заявки подтянем отдельным запросом — нужны для столбца «комментарий»
    const trialClientIds = [...new Set(trials.map((t) => t.clientId))]
    const apps = trialClientIds.length
      ? await db.application.findMany({
          where: { tenantId, clientId: { in: trialClientIds }, deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, clientId: true, comment: true },
        })
      : []
    const appByClient = new Map<string, (typeof apps)[number]>()
    for (const a of apps) if (!appByClient.has(a.clientId)) appByClient.set(a.clientId, a)

    rows = trials.map((t) => {
      const app = appByClient.get(t.clientId)
      const direction = t.group?.direction ?? t.direction ?? null
      return {
        rowId: t.id,
        applicationId: app?.id,
        clientId: t.client.id,
        state: t.client._count.payments > 0 ? "client" : "lead",
        firstName: t.client.firstName,
        lastName: t.client.lastName,
        phone: maskPhone(t.client.phone, role),
        socialLink: t.client.socialLink,
        channelName: t.client.channel?.name ?? null,
        ward: t.ward
          ? { id: t.ward.id, firstName: t.ward.firstName, lastName: t.ward.lastName }
          : { id: t.clientId, firstName: "—", lastName: null },
        branchId:
          t.group?.branch?.id ?? t.room?.branch?.id ?? t.client.branch?.id ?? null,
        branchName:
          t.group?.branch?.name ?? t.room?.branch?.name ?? t.client.branch?.name ?? null,
        directionId: direction?.id ?? null,
        directionName: direction?.name ?? null,
        groupId: t.group?.id ?? null,
        groupOrTimeLabel:
          t.group?.name ??
          (t.startTime
            ? `Индив. ${t.startTime}${t.durationMinutes ? `, ${t.durationMinutes}мин` : ""}`
            : null),
        scheduledDate: t.scheduledDate ? t.scheduledDate.toISOString() : null,
        startTime: t.startTime ?? t.lesson?.startTime ?? null,
        lessonId: t.lessonId ?? null,
        trialLessonId: t.id,
        firstPaidLessonDate: t.client.firstPaidLessonDate
          ? t.client.firstPaidLessonDate.toISOString()
          : null,
        expectedSubscriptionAmount: null,
        createdAt: t.createdAt ? t.createdAt.toISOString() : null,
        nextContactDate: t.client.nextContactDate
          ? t.client.nextContactDate.toISOString()
          : null,
        comment: app?.comment ?? null,
        assignedTo: t.client.assignedTo,
      }
    })
  } else {
    // tab in ('trial_done', 'awaiting_payment') — читаются по Ward.
    // Один Ward = одна строка. salesStage определяет вкладку; для отображения
    // подтягиваем последнее «представительное» пробное.
    const stage = TAB_TO_STAGE[tab]
    // attended-пробное основной кейс, но если стадия Ward была сдвинута вручную
    // (через ПКМ-меню) без отметки в Расписании, scheduled-пробное всё ещё
    // актуально и его данные нужно показать в строке.
    const trialLessonFilter: Prisma.TrialLessonWhereInput = {
      status: { in: ["attended", "scheduled"] },
    }
    // status asc: 'attended' < 'scheduled' алфавитно → attended вперёд.
    const trialLessonOrder: Prisma.TrialLessonOrderByWithRelationInput[] = [
      { status: "asc" },
      { scheduledDate: "desc" },
    ]

    const wards = await db.ward.findMany({
      where: wardSalesWhereWithFilters(tenantId, stage, branchFilter, directionFilter, scope),
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            socialLink: true,
            comment: true,
            nextContactDate: true,
            assignedTo: true,
            firstPaidLessonDate: true,
            branch: { select: { id: true, name: true } },
            channel: { select: { id: true, name: true } },
            _count: { select: { payments: true } },
          },
        },
        trialLessons: {
          where: trialLessonFilter,
          orderBy: trialLessonOrder,
          take: 1,
          include: {
            group: {
              select: {
                id: true,
                name: true,
                branch: { select: { id: true, name: true } },
                direction: { select: { id: true, name: true, lessonPrice: true } },
              },
            },
            direction: { select: { id: true, name: true, lessonPrice: true } },
            room: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
            // Для групповых пробных время хранится у связанного Lesson; у TrialLesson.startTime
            // оно null. Подтягиваем для отображения «ДД.ММ.ГГГГ HH:MM».
            lesson: { select: { startTime: true } },
          },
        },
        // Комментарий «по заявке» показываем во всех вкладках продаж — берём
        // последнюю не-удалённую заявку подопечного (на этих стадиях она, как
        // правило, уже processed).
        applications: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, comment: true },
        },
      },
      orderBy: { salesStageAt: "desc" },
    })

    rows = wards.map((w) => {
      const t = w.trialLessons[0]
      const app = w.applications[0]
      const direction = t?.group?.direction ?? t?.direction ?? null
      const lessonPrice = direction?.lessonPrice ? Number(direction.lessonPrice) : 0
      // Простая оценка: 8 занятий × стоимость занятия (фактическое количество
      // зависит от расписания группы и месяца — уточняется при оформлении абонемента).
      const expected =
        tab === "awaiting_payment" && lessonPrice > 0 ? fmtMoney(lessonPrice * 8) : null
      return {
        rowId: w.id,
        applicationId: app?.id,
        clientId: w.client.id,
        state: w.client._count.payments > 0 ? "client" : "lead",
        firstName: w.client.firstName,
        lastName: w.client.lastName,
        phone: maskPhone(w.client.phone, role),
        socialLink: w.client.socialLink,
        channelName: w.client.channel?.name ?? null,
        ward: { id: w.id, firstName: w.firstName, lastName: w.lastName },
        branchId:
          t?.group?.branch?.id ?? t?.room?.branch?.id ?? w.client.branch?.id ?? null,
        branchName:
          t?.group?.branch?.name ?? t?.room?.branch?.name ?? w.client.branch?.name ?? null,
        directionId: direction?.id ?? null,
        directionName: direction?.name ?? null,
        groupId: t?.group?.id ?? null,
        groupOrTimeLabel:
          t?.group?.name ??
          (t?.startTime
            ? `Индив. ${t.startTime}${t.durationMinutes ? `, ${t.durationMinutes}мин` : ""}`
            : null),
        scheduledDate: t?.scheduledDate ? t.scheduledDate.toISOString() : null,
        startTime: t?.startTime ?? t?.lesson?.startTime ?? null,
        lessonId: t?.lessonId ?? null,
        trialLessonId: t?.id ?? null,
        firstPaidLessonDate: w.client.firstPaidLessonDate
          ? w.client.firstPaidLessonDate.toISOString()
          : null,
        expectedSubscriptionAmount: expected,
        createdAt: w.salesStageAt ? w.salesStageAt.toISOString() : null,
        nextContactDate: w.client.nextContactDate
          ? w.client.nextContactDate.toISOString()
          : null,
        comment: app?.comment ?? null,
        assignedTo: w.client.assignedTo,
      }
    })
  }

  const tabs: SalesTab[] = TAB_ORDER.map((t) => ({
    value: t,
    label: TAB_LABELS[t],
    count: counts[t],
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Продажи</h1>
          <PageHelp pageKey="crm/sales" />
        </div>
        <CreateClientDialog />
      </div>

      <SalesTabs tabs={tabs} current={tab} />

      <SalesTable
        tab={tab}
        rows={rows}
        employees={employees}
        branches={branches}
        branchId={branchFilter}
        directions={directions}
        directionId={directionFilter}
      />
    </div>
  )
}
