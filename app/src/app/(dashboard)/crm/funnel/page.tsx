import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma, FunnelStatus } from "@prisma/client"
import { Card, CardContent } from "@/components/ui/card"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { PageHelp } from "@/components/page-help"
import { QuickLeadButton } from "@/components/quick-lead-button"
import { FunnelSortSelect } from "./funnel-sort-select"
import { FunnelTabs, type FunnelTab } from "./funnel-tabs"
import { LeadsTable, type LeadRow } from "./leads-table"

const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  potential: "Потенциальный",
  non_target: "Не целевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

// Активные статусы воронки — то, что показывается во вкладке «Все»
const ACTIVE_FUNNEL_STATUSES: FunnelStatus[] = [
  "new",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
  "potential",
  "non_target",
]

// Порядок вкладок
const TAB_STATUSES: FunnelStatus[] = [
  "new",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
  "potential",
  "non_target",
  "blacklisted",
  "archived",
]

// Карточки-счётчики (рабочая воронка)
const COUNTER_STATUSES: FunnelStatus[] = [
  "new",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
]

function buildOrderBy(sort: string): Prisma.ClientOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ lastName: { sort: "asc", nulls: "last" } }, { firstName: "asc" }]
    case "createdAt":
      return [{ createdAt: "desc" }]
    case "nextContactDate":
    default:
      return [{ nextContactDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
  }
}

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; status?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { sort = "nextContactDate", status = "" } = await searchParams

  const [branches, employees] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, role: { not: "readonly" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeBranches: { select: { branchId: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ])

  const orderBy = buildOrderBy(sort)

  // Условие выборки: по статусу или «все рабочие»
  const statusFilter: Prisma.ClientWhereInput = status
    ? { funnelStatus: status as FunnelStatus }
    : { funnelStatus: { in: ACTIVE_FUNNEL_STATUSES } }

  const leads = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...statusFilter,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      nextContactDate: true,
      createdAt: true,
      assignedTo: true,
      branchId: true,
      branch: { select: { name: true } },
    },
    orderBy,
    take: 200,
  })

  // Счётчики по статусам
  const counts = await db.client.groupBy({
    by: ["funnelStatus"],
    where: { tenantId, deletedAt: null },
    _count: true,
  })
  const countMap = new Map(counts.map(c => [c.funnelStatus as string, c._count]))

  const totalActive = ACTIVE_FUNNEL_STATUSES.reduce(
    (sum, s) => sum + (countMap.get(s) || 0),
    0
  )

  const tabs: FunnelTab[] = [
    { value: "", label: "Все", count: totalActive },
    ...TAB_STATUSES.map((s) => ({
      value: s,
      label: STATUS_LABELS[s] || s,
      count: countMap.get(s) || 0,
    })),
  ]

  // Сериализуем для client-component: Date → ISO-строка
  const leadRows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    phone: l.phone,
    branchId: l.branchId,
    branchName: l.branch?.name ?? null,
    assignedTo: l.assignedTo,
    nextContactDate: l.nextContactDate ? l.nextContactDate.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Воронка продаж</h1>
          <PageHelp pageKey="crm/funnel" />
        </div>
        <div className="flex items-center gap-2">
          <FunnelSortSelect />
          <CreateClientDialog branches={branches} />
        </div>
      </div>

      {/* Счётчики */}
      <div className="flex flex-wrap gap-3">
        {COUNTER_STATUSES.map((s) => (
          <Card key={s} className="min-w-[140px]">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{countMap.get(s) || 0}</p>
              <p className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Вкладки по статусам */}
      <FunnelTabs tabs={tabs} current={status} />

      {/* Таблица лидов */}
      {leadRows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет лидов в выбранной категории
          </CardContent>
        </Card>
      ) : (
        <LeadsTable leads={leadRows} employees={employees} />
      )}

      <QuickLeadButton />
    </div>
  )
}
