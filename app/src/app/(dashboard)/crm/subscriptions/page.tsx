import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { PageHelp } from "@/components/page-help"
import { SubscriptionsTable, type SubscriptionRow, type SubsTabKey } from "./subscriptions-table"

const TAB_LABELS: Record<SubsTabKey, string> = {
  active: "Активные",
  pending: "Ожидающие оплаты",
  finished: "Закончившиеся",
}
const TAB_ORDER: SubsTabKey[] = ["active", "pending", "finished"]

function buildWhere(
  tab: SubsTabKey,
  tenantId: string,
  filters: { branchId?: string; directionId?: string; query?: string },
): Prisma.SubscriptionWhereInput {
  const base: Prisma.SubscriptionWhereInput = { tenantId, deletedAt: null }
  if (tab === "active") base.status = "active"
  else if (tab === "pending") base.status = "pending"
  else base.status = { in: ["closed", "withdrawn"] }

  if (filters.directionId) base.directionId = filters.directionId
  if (filters.branchId) base.group = { branchId: filters.branchId }

  if (filters.query) {
    const tokens = filters.query.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    const digits = filters.query.replace(/\D/g, "")
    const tokenClauses: Prisma.SubscriptionWhereInput[] = tokens.map((token) => ({
      OR: [
        { client: { firstName: { contains: token, mode: "insensitive" } } },
        { client: { lastName: { contains: token, mode: "insensitive" } } },
        { ward: { firstName: { contains: token, mode: "insensitive" } } },
        { ward: { lastName: { contains: token, mode: "insensitive" } } },
      ],
    }))
    const altOr: Prisma.SubscriptionWhereInput[] = []
    if (tokenClauses.length > 0) altOr.push({ AND: tokenClauses })
    if (digits) altOr.push({ client: { phone: { contains: digits } } })
    if (altOr.length > 0) {
      return { AND: [base, { OR: altOr }] }
    }
  }
  return base
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; branch?: string; direction?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const sp = await searchParams
  const tab: SubsTabKey = (TAB_ORDER as string[]).includes(sp.tab ?? "")
    ? (sp.tab as SubsTabKey)
    : "active"
  const query = (sp.q ?? "").trim()
  const branchId = sp.branch && sp.branch !== "all" ? sp.branch : undefined
  const directionId = sp.direction && sp.direction !== "all" ? sp.direction : undefined

  const baseFilters = { branchId, directionId, query }
  const [branches, directions, countActive, countPending, countFinished, rows] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.subscription.count({ where: buildWhere("active", tenantId, baseFilters) }),
    db.subscription.count({ where: buildWhere("pending", tenantId, baseFilters) }),
    db.subscription.count({ where: buildWhere("finished", tenantId, baseFilters) }),
    db.subscription.findMany({
      where: buildWhere(tab, tenantId, baseFilters),
      select: {
        id: true,
        status: true,
        type: true,
        clientId: true,
        client: { select: { firstName: true, lastName: true } },
        ward: { select: { firstName: true, lastName: true } },
        direction: { select: { name: true } },
        group: { select: { name: true, branch: { select: { name: true } } } },
        finalAmount: true,
        chargedAmount: true,
        discountAmount: true,
        startDate: true,
        endDate: true,
        expiresAt: true,
        discounts: {
          where: { isActive: true },
          select: { id: true, calculatedAmount: true, type: true, valueType: true, value: true },
        },
      },
      orderBy: { startDate: "desc" },
      take: 500,
    }),
  ])

  const mapped: SubscriptionRow[] = rows.map((s) => {
    const wardName =
      s.ward
        ? [s.ward.lastName, s.ward.firstName].filter(Boolean).join(" ").trim() || s.ward.firstName
        : [s.client.lastName, s.client.firstName].filter(Boolean).join(" ").trim() || "Без имени"

    const discountAmountNum = Number(s.discountAmount)
    let discountLabel = "—"
    if (s.discounts.length > 0) {
      // Связи Discount → DiscountTemplate в схеме пока нет; до её появления
      // показываем тип и значение скидки.
      const d = s.discounts[0]
      const valueStr =
        d.valueType === "percent"
          ? `${Number(d.value)}%`
          : `${Number(d.value).toLocaleString("ru-RU")} ₽`
      discountLabel = `${typeLabel(d.type)} (${valueStr})`
    } else if (discountAmountNum > 0) {
      discountLabel = `−${discountAmountNum.toLocaleString("ru-RU")} ₽`
    }

    return {
      id: s.id,
      clientId: s.clientId,
      wardName,
      directionName: s.direction.name,
      branchName: s.group.branch.name,
      groupName: s.group.name,
      finalAmount: Number(s.finalAmount),
      chargedAmount: Number(s.chargedAmount),
      startDate: s.startDate.toISOString(),
      endDate: s.endDate ? s.endDate.toISOString() : null,
      expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
      discountLabel,
    }
  })

  const counts: Record<SubsTabKey, number> = {
    active: countActive,
    pending: countPending,
    finished: countFinished,
  }
  const tabs = TAB_ORDER.map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))

  const canRenew = session.user.role === "owner" || session.user.role === "manager"

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Абонементы</h1>
        <PageHelp pageKey="crm/subscriptions" />
      </div>

      <SubscriptionsTable
        tab={tab}
        tabs={tabs}
        rows={mapped}
        branches={branches}
        directions={directions}
        initialQuery={query}
        initialBranchId={branchId ?? "all"}
        initialDirectionId={directionId ?? "all"}
        canRenew={canRenew}
      />
    </div>
  )
}

function typeLabel(t: "permanent" | "one_time" | "linked"): string {
  if (t === "permanent") return "Постоянная"
  if (t === "one_time") return "Разовая"
  return "Связанная"
}
