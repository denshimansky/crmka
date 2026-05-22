import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { PageHelp } from "@/components/page-help"
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

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { tab: rawTab } = await searchParams
  const tab: SalesTabKey = TAB_ORDER.includes(rawTab as SalesTabKey)
    ? (rawTab as SalesTabKey)
    : "application"

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
    db.application.count({ where: { tenantId, status: "active", deletedAt: null } }),
    db.trialLesson.count({ where: { tenantId, status: "scheduled" } }),
    db.trialLesson.count({
      where: {
        tenantId,
        status: "attended",
        client: { funnelStatus: "trial_attended", deletedAt: null },
      },
    }),
    db.client.count({
      where: { tenantId, deletedAt: null, funnelStatus: "awaiting_payment" },
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
    const apps = await db.application.findMany({
      where: { tenantId, status: "active", deletedAt: null },
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
            channel: { select: { id: true, name: true } },
            _count: { select: { payments: true } },
          },
        },
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
      phone: a.client.phone,
      socialLink: a.client.socialLink,
      channelName: a.client.channel?.name ?? null,
      ward: a.ward,
      branchName: a.branch.name,
      directionName: a.direction.name,
      groupOrTimeLabel: null,
      scheduledDate: null,
      firstPaidLessonDate: a.client.firstPaidLessonDate ? a.client.firstPaidLessonDate.toISOString() : null,
      expectedSubscriptionAmount: null,
      createdAt: a.createdAt.toISOString(),
      nextContactDate: a.client.nextContactDate ? a.client.nextContactDate.toISOString() : null,
      comment: a.client.comment,
      assignedTo: a.client.assignedTo,
    }))
  } else if (tab === "trial" || tab === "trial_done") {
    const trialStatus = tab === "trial" ? "scheduled" : "attended"
    const trials = await db.trialLesson.findMany({
      where: {
        tenantId,
        status: trialStatus,
        ...(tab === "trial_done"
          ? { client: { funnelStatus: "trial_attended", deletedAt: null } }
          : {}),
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
            direction: { select: { id: true, name: true } },
          },
        },
        direction: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      },
      orderBy: { scheduledDate: tab === "trial" ? "asc" : "desc" },
    })
    rows = trials
      .filter((t) => t.client && t.ward)
      .map((t) => ({
        rowId: t.id,
        clientId: t.client.id,
        state: t.client._count.payments > 0 ? "client" : "lead",
        firstName: t.client.firstName,
        lastName: t.client.lastName,
        phone: t.client.phone,
        socialLink: t.client.socialLink,
        channelName: t.client.channel?.name ?? null,
        ward: t.ward!,
        branchName: t.group?.branch?.name ?? t.room?.branch?.name ?? null,
        directionName: t.group?.direction?.name ?? t.direction?.name ?? null,
        groupOrTimeLabel:
          t.group?.name ??
          (t.startTime
            ? `Индив. ${t.startTime}${t.durationMinutes ? `, ${t.durationMinutes}мин` : ""}`
            : null),
        scheduledDate: t.scheduledDate.toISOString(),
        firstPaidLessonDate: t.client.firstPaidLessonDate
          ? t.client.firstPaidLessonDate.toISOString()
          : null,
        expectedSubscriptionAmount: null,
        createdAt: null,
        nextContactDate: t.client.nextContactDate ? t.client.nextContactDate.toISOString() : null,
        comment: t.client.comment,
        assignedTo: t.client.assignedTo,
      }))
  } else {
    // awaiting_payment
    const clients = await db.client.findMany({
      where: { tenantId, deletedAt: null, funnelStatus: "awaiting_payment" },
      include: {
        branch: { select: { id: true, name: true } },
        wards: { select: { id: true, firstName: true, lastName: true } },
        channel: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
        trialLessons: {
          where: { status: "attended" },
          orderBy: { attendedAt: "desc" },
          take: 1,
          include: {
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
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    })
    rows = clients.map((c) => {
      const trial = c.trialLessons[0]
      const trialWard = trial?.ward ?? c.wards[0] ?? { id: "", firstName: "—", lastName: null }
      const direction = trial?.group?.direction ?? trial?.direction ?? null
      const lessonPrice = direction?.lessonPrice ? Number(direction.lessonPrice) : 0
      // Простая оценка: 8 занятий × стоимость занятия (фактическое количество
      // зависит от расписания группы и месяца — уточняется при оформлении абонемента).
      const expected = lessonPrice > 0 ? fmtMoney(lessonPrice * 8) : null
      return {
        rowId: c.id,
        clientId: c.id,
        state: c._count.payments > 0 ? "client" : "lead",
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        socialLink: c.socialLink,
        channelName: c.channel?.name ?? null,
        ward: trialWard,
        branchName: trial?.group?.branch?.name ?? c.branch?.name ?? null,
        directionName: direction?.name ?? null,
        groupOrTimeLabel: trial?.group?.name ?? null,
        scheduledDate: trial?.scheduledDate ? trial.scheduledDate.toISOString() : null,
        firstPaidLessonDate: c.firstPaidLessonDate ? c.firstPaidLessonDate.toISOString() : null,
        expectedSubscriptionAmount: expected,
        createdAt: c.createdAt.toISOString(),
        nextContactDate: c.nextContactDate ? c.nextContactDate.toISOString() : null,
        comment: c.comment,
        assignedTo: c.assignedTo,
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
        <CreateClientDialog branches={branches} />
      </div>

      <SalesTabs tabs={tabs} current={tab} />

      <SalesTable tab={tab} rows={rows} employees={employees} />
    </div>
  )
}
