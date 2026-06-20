import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma, WardSalesStage } from "@prisma/client"
import { PageHelp } from "@/components/page-help"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { SalesTabs, type SalesTab } from "./sales-tabs"
import { SalesTable, type SalesRow, type SalesTabKey } from "./sales-table"
import { ContactTable, type ContactRow } from "./contact-table"
import { scopeBranch, type BranchScope, isUnscoped } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

// Раздел «Продажи» = 4 этапа воронки заявок + вкладка «Связь» (клиенты с
// назначенной датой связи). «Связь» ведётся по клиенту, а не по заявке.
type PageTabKey = SalesTabKey | "contact"

const TAB_LABELS: Record<PageTabKey, string> = {
  application: "Заявка",
  trial: "Пробное",
  trial_done: "Прошёл пробное",
  awaiting_payment: "Ожидаем оплату",
  contact: "Связь",
}
const TAB_ORDER: PageTabKey[] = ["application", "trial", "trial_done", "awaiting_payment", "contact"]

// Воронка ведётся по заявке (Application.stage). Вкладка = этап. Сумма строк по
// всем вкладкам = число активных заявок.
const TAB_TO_STAGE: Record<SalesTabKey, WardSalesStage> = {
  application: "application",
  trial: "trial_scheduled",
  trial_done: "trial_attended",
  awaiting_payment: "awaiting_payment",
}

// Фильтр родителя для всех вкладок «Продаж»: исключаем только архив и ЧС.
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

// Where для активных заявок на конкретном этапе + фильтры филиал/направление.
function appFunnelWhere(
  tenantId: string,
  stage: WardSalesStage,
  branchFilter: string | null,
  directionFilter: string | null,
  scope: BranchScope,
): Prisma.ApplicationWhereInput {
  return {
    tenantId,
    status: "active",
    deletedAt: null,
    stage,
    client: notArchivedClient(scope),
    ...(branchFilter ? { branchId: branchFilter } : {}),
    ...(directionFilter ? { directionId: directionFilter } : {}),
  }
}

const CLIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  socialLink: true,
  comment: true,
  nextContactDate: true,
  assignedTo: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  channel: { select: { id: true, name: true } },
  _count: { select: { payments: true } },
} as const

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
  const tab: PageTabKey = TAB_ORDER.includes(rawTab as PageTabKey)
    ? (rawTab as PageTabKey)
    : "application"
  // ADM-04: пересечение явного фильтра по филиалу из URL и серверного scope.
  const rawBranch = rawBranchId && rawBranchId !== "all" ? rawBranchId : null
  const branchFilter =
    rawBranch && (isUnscoped(scope) || scope.branchIds.includes(rawBranch))
      ? rawBranch
      : null
  const directionFilter =
    rawDirectionId && rawDirectionId !== "all" ? rawDirectionId : null

  const branchWhere: Prisma.BranchWhereInput = {
    tenantId,
    deletedAt: null,
    ...scopeBranch(scope),
  }

  // Вкладка «Связь»: клиенты/лиды с назначенной датой связи (любой этап воронки,
  // кроме архива/ЧС). Тот же клиентский фильтр и scope, что и в остальных вкладках.
  const contactWhere: Prisma.ClientWhereInput = {
    tenantId,
    AND: [
      notArchivedClient(scope),
      { nextContactDate: { not: null } },
      ...(branchFilter ? [{ branchId: branchFilter }] : []),
    ],
  }

  const [
    branches,
    directions,
    employees,
    countApplication,
    countTrial,
    countTrialDone,
    countAwaitingPayment,
    countContact,
  ] = await Promise.all([
    db.branch.findMany({
      where: branchWhere,
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
    // Счётчики = число активных заявок на каждом этапе (с учётом фильтров).
    // Сумма по вкладкам = всего активных заявок.
    db.application.count({ where: appFunnelWhere(tenantId, "application", branchFilter, directionFilter, scope) }),
    db.application.count({ where: appFunnelWhere(tenantId, "trial_scheduled", branchFilter, directionFilter, scope) }),
    db.application.count({ where: appFunnelWhere(tenantId, "trial_attended", branchFilter, directionFilter, scope) }),
    db.application.count({ where: appFunnelWhere(tenantId, "awaiting_payment", branchFilter, directionFilter, scope) }),
    db.client.count({ where: contactWhere }),
  ])

  const counts: Record<PageTabKey, number> = {
    application: countApplication,
    trial: countTrial,
    trial_done: countTrialDone,
    awaiting_payment: countAwaitingPayment,
    contact: countContact,
  }

  let rows: SalesRow[] = []
  let contactRows: ContactRow[] = []

  if (tab === "contact") {
    const contactClients = await db.client.findMany({
      where: contactWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        funnelStatus: true,
        clientStatus: true,
        nextContactDate: true,
        comment: true,
        assignee: { select: { firstName: true, lastName: true } },
        wards: { select: { id: true, firstName: true, lastName: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { nextContactDate: "asc" }, // ближайшие связи — сверху
    })
    contactRows = contactClients.map((c) => ({
      clientId: c.id,
      name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
      phone: maskPhone(c.phone, role),
      funnelStatus: c.funnelStatus,
      clientStatus: c.clientStatus,
      nextContactDate: c.nextContactDate!.toISOString(),
      comment: c.comment ?? null,
      wards: c.wards.map((w) => ({
        id: w.id,
        name: [w.lastName, w.firstName].filter(Boolean).join(" ") || "—",
      })),
      assigneeName: c.assignee
        ? [c.assignee.lastName, c.assignee.firstName].filter(Boolean).join(" ") || null
        : null,
    }))
  } else if (tab === "application") {
    const where = appFunnelWhere(tenantId, TAB_TO_STAGE[tab], branchFilter, directionFilter, scope)
    // Этап «Заявка» — данные пробного/абонемента не нужны.
    const apps = await db.application.findMany({
      where,
      include: {
        client: { select: CLIENT_SELECT },
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
        direction: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    rows = apps.map((a) => ({
      rowId: a.id,
      applicationId: a.id,
      clientId: a.client.id,
      state: a.client._count.payments > 0 ? "client" : "lead",
      firstName: a.client.firstName,
      lastName: a.client.lastName,
      phone: maskPhone(a.client.phone, role),
      socialLink: a.client.socialLink,
      channelName: a.client.channel?.name ?? null,
      ward: { id: a.ward.id, firstName: a.ward.firstName, lastName: a.ward.lastName },
      branchId: a.branch?.id ?? a.client.branch?.id ?? null,
      branchName: a.branch?.name ?? a.client.branch?.name ?? null,
      directionId: a.direction?.id ?? null,
      directionName: a.direction?.name ?? null,
      groupId: null,
      groupOrTimeLabel: null,
      scheduledDate: null,
      startTime: null,
      lessonId: null,
      firstPaidLessonDate: a.firstPaidLessonDate ? a.firstPaidLessonDate.toISOString() : null,
      expectedSubscriptionAmount: null,
      createdAt: a.createdAt.toISOString(),
      nextContactDate: a.client.nextContactDate ? a.client.nextContactDate.toISOString() : null,
      comment: a.comment ?? null,
      assignedTo: a.client.assignedTo,
    }))
  } else if (tab === "trial" || tab === "trial_done") {
    const where = appFunnelWhere(tenantId, TAB_TO_STAGE[tab], branchFilter, directionFilter, scope)
    // «Пробное» показывает заявки на этапе trial_scheduled, с представительным
    // пробным (scheduled или no_show — «не пришёл» остаётся здесь). «Прошёл пробное»
    // — этап trial_attended с attended-пробным.
    const trialStatusFilter: Prisma.TrialLessonWhereInput =
      tab === "trial"
        ? { status: { in: ["scheduled", "no_show"] } }
        : { status: "attended" }

    const apps = await db.application.findMany({
      where,
      include: {
        client: { select: CLIENT_SELECT },
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
        direction: { select: { id: true, name: true } },
        trialLessons: {
          where: trialStatusFilter,
          orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
          take: 5,
          include: {
            group: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
            room: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
            lesson: { select: { startTime: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    })

    rows = apps.map((a) => {
      // Представительное пробное: активное (scheduled) приоритетнее неявки,
      // даже если неявка датирована позже — иначе строка скрывает живое пробное
      // и его невозможно перенести («Изменить» не отменит, создание упрётся в 409).
      const t = a.trialLessons.find((x) => x.status === "scheduled") ?? a.trialLessons[0]
      const branchFromTrial = t?.group?.branch ?? t?.room?.branch ?? null
      return {
        rowId: a.id,
        applicationId: a.id,
        clientId: a.client.id,
        state: a.client._count.payments > 0 ? "client" : "lead",
        firstName: a.client.firstName,
        lastName: a.client.lastName,
        phone: maskPhone(a.client.phone, role),
        socialLink: a.client.socialLink,
        channelName: a.client.channel?.name ?? null,
        ward: { id: a.ward.id, firstName: a.ward.firstName, lastName: a.ward.lastName },
        branchId: a.branch?.id ?? branchFromTrial?.id ?? a.client.branch?.id ?? null,
        branchName: a.branch?.name ?? branchFromTrial?.name ?? a.client.branch?.name ?? null,
        directionId: a.direction?.id ?? null,
        directionName: a.direction?.name ?? null,
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
        trialStatus: t?.status ?? null,
        trialConfirmed: t?.confirmed ?? null,
        trialDirectionId: t?.directionId ?? null,
        trialInstructorId: t?.instructorId ?? null,
        trialRoomId: t?.roomId ?? null,
        trialDurationMinutes: t?.durationMinutes ?? null,
        firstPaidLessonDate: a.firstPaidLessonDate ? a.firstPaidLessonDate.toISOString() : null,
        expectedSubscriptionAmount: null,
        createdAt: a.createdAt.toISOString(),
        nextContactDate: a.client.nextContactDate ? a.client.nextContactDate.toISOString() : null,
        comment: a.comment ?? null,
        assignedTo: a.client.assignedTo,
      }
    })
  } else {
    const where = appFunnelWhere(tenantId, TAB_TO_STAGE[tab], branchFilter, directionFilter, scope)
    // «Ожидаем оплату» — этап awaiting_payment. Абонемент (pending/active) того же
    // ребёнка и направления даёт стоимость, группу и дату первого платного.
    const apps = await db.application.findMany({
      where,
      include: {
        client: { select: CLIENT_SELECT },
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
        direction: { select: { id: true, name: true } },
        // Пробное «где ребёнок был» (attended) — его дата показывается в строке.
        // Несколько посещённых пробных по заявке → несколько строк (flatMap ниже).
        trialLessons: {
          where: { status: "attended" },
          orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
          include: { lesson: { select: { startTime: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    })

    const wardIds = [...new Set(apps.map((a) => a.wardId))]
    const subs = wardIds.length
      ? await db.subscription.findMany({
          where: {
            tenantId,
            wardId: { in: wardIds },
            status: { in: ["pending", "active"] },
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            wardId: true,
            directionId: true,
            startDate: true,
            finalAmount: true,
            group: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
          },
        })
      : []
    const subByKey = new Map<string, (typeof subs)[number]>()
    for (const s of subs) {
      const key = `${s.wardId}:${s.directionId}`
      if (!subByKey.has(key)) subByKey.set(key, s)
    }

    rows = apps.flatMap((a) => {
      const sub = subByKey.get(`${a.wardId}:${a.directionId}`)
      const base: SalesRow = {
        rowId: a.id,
        applicationId: a.id,
        clientId: a.client.id,
        state: a.client._count.payments > 0 ? "client" : "lead",
        firstName: a.client.firstName,
        lastName: a.client.lastName,
        phone: maskPhone(a.client.phone, role),
        socialLink: a.client.socialLink,
        channelName: a.client.channel?.name ?? null,
        ward: { id: a.ward.id, firstName: a.ward.firstName, lastName: a.ward.lastName },
        branchId: a.branch?.id ?? sub?.group?.branch?.id ?? a.client.branch?.id ?? null,
        branchName: a.branch?.name ?? sub?.group?.branch?.name ?? a.client.branch?.name ?? null,
        directionId: a.direction?.id ?? null,
        directionName: a.direction?.name ?? null,
        groupId: sub?.group?.id ?? null,
        groupOrTimeLabel: sub?.group?.name ?? null,
        subscriptionId: sub?.id ?? null,
        scheduledDate: null,
        startTime: null,
        lessonId: null,
        firstPaidLessonDate: a.firstPaidLessonDate
          ? a.firstPaidLessonDate.toISOString()
          : sub?.startDate
            ? sub.startDate.toISOString()
            : null,
        expectedSubscriptionAmount: sub ? fmtMoney(Number(sub.finalAmount)) : null,
        createdAt: a.createdAt.toISOString(),
        nextContactDate: a.client.nextContactDate ? a.client.nextContactDate.toISOString() : null,
        comment: a.comment ?? null,
        assignedTo: a.client.assignedTo,
      }
      // Нет посещённого пробного (например, продажа без пробного) — одна строка
      // без даты пробного. Иначе — отдельная строка на каждое посещённое пробное
      // (в т.ч. из разных заявок: строки тут идут по заявкам).
      if (a.trialLessons.length === 0) return [base]
      return a.trialLessons.map((t) => ({
        ...base,
        rowId: `${a.id}:${t.id}`,
        scheduledDate: t.scheduledDate ? t.scheduledDate.toISOString() : null,
        startTime: t.startTime ?? t.lesson?.startTime ?? null,
        lessonId: t.lessonId ?? null,
        trialLessonId: t.id,
        trialStatus: t.status,
      }))
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

      {tab === "contact" ? (
        <ContactTable rows={contactRows} canEdit={role !== "readonly"} />
      ) : (
        <SalesTable
          tab={tab}
          rows={rows}
          employees={employees}
          branches={branches}
          branchId={branchFilter}
          directions={directions}
          directionId={directionFilter}
        />
      )}
    </div>
  )
}
