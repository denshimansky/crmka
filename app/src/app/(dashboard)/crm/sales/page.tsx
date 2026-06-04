import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma, WardSalesStage } from "@prisma/client"
import { PageHelp } from "@/components/page-help"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { SalesTabs, type SalesTab } from "./sales-tabs"
import { SalesTable, type SalesRow, type SalesTabKey } from "./sales-table"

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
function notArchivedClient(): Prisma.ClientWhereInput {
  return {
    deletedAt: null,
    funnelStatus: { notIn: ["archived", "blacklisted"] },
  }
}

function wardSalesWhere(tenantId: string, stage: WardSalesStage): Prisma.WardWhereInput {
  return {
    tenantId,
    salesStage: stage,
    client: notArchivedClient(),
  }
}

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; branchId?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const role = session.user.role
  const { tab: rawTab, branchId: rawBranchId } = await searchParams
  const tab: SalesTabKey = TAB_ORDER.includes(rawTab as SalesTabKey)
    ? (rawTab as SalesTabKey)
    : "application"
  const branchFilter = rawBranchId && rawBranchId !== "all" ? rawBranchId : null

  const [
    branches,
    employees,
    countApplication,
    countTrial,
    countTrialDone,
    countAwaitingPayment,
  ] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, role: { not: "readonly" } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    db.ward.count({ where: wardSalesWhere(tenantId, "application") }),
    db.ward.count({ where: wardSalesWhere(tenantId, "trial_scheduled") }),
    db.ward.count({ where: wardSalesWhere(tenantId, "trial_attended") }),
    db.ward.count({ where: wardSalesWhere(tenantId, "awaiting_payment") }),
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
      where: wardSalesWhere(tenantId, "application"),
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
  } else {
    // tab in ('trial', 'trial_done', 'awaiting_payment') — все три читаются по Ward.
    // Один Ward = одна строка. salesStage определяет вкладку; для отображения подтягиваем
    // одно «представительное» пробное (запланированное для trial, последнее attended для остальных).
    const stage = TAB_TO_STAGE[tab]
    // На trial_done / awaiting_payment основной кейс — attended-пробное,
    // но если стадия Ward была сдвинута вручную (через ПКМ-меню) без отметки
    // в Расписании, scheduled-пробное всё ещё актуально и его данные нужно
    // показать в строке. Берём любой не-cancelled, attended приоритизируем.
    const trialLessonFilter: Prisma.TrialLessonWhereInput =
      tab === "trial"
        ? { status: "scheduled" }
        : { status: { in: ["attended", "scheduled"] } }
    const trialLessonOrder: Prisma.TrialLessonOrderByWithRelationInput[] =
      tab === "trial"
        ? [{ scheduledDate: "asc" }]
        // status asc: 'attended' < 'scheduled' алфавитно → attended вперёд.
        : [{ status: "asc" }, { scheduledDate: "desc" }]

    // Branch filter: фильтр работает по филиалу пробного занятия (группы или
    // кабинета индивидуального). Применяется только когда пользователь выбрал
    // филиал в шапке вкладки «Пробное» (для других вкладок фильтр пока не показан).
    const wardWhereWithBranch: Prisma.WardWhereInput =
      branchFilter && tab === "trial"
        ? {
            ...wardSalesWhere(tenantId, stage),
            trialLessons: {
              some: {
                ...trialLessonFilter,
                OR: [{ group: { branchId: branchFilter } }, { room: { branchId: branchFilter } }],
              },
            },
          }
        : wardSalesWhere(tenantId, stage)

    const wards = await db.ward.findMany({
      where: wardWhereWithBranch,
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
      orderBy:
        tab === "trial"
          ? { salesStageAt: "asc" }
          : { salesStageAt: "desc" },
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
      />
    </div>
  )
}
