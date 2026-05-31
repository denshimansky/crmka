import Link from "next/link"
import { Copy } from "lucide-react"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { PageHelp } from "@/components/page-help"
import { QuickLeadButton } from "@/components/quick-lead-button"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { ContactsTabs, type ContactsTab } from "./contacts-tabs"
import { ContactsTable, type ContactRow, type ContactsTabKey } from "./contacts-table"
import { maskPhone } from "@/lib/permissions/phone-visibility"

const TAB_LABELS: Record<ContactsTabKey, string> = {
  leads: "Лиды",
  potential: "Потенциал",
  nontarget: "Нецелевой",
  active: "Активные",
  churned: "Выбывшие",
  archived: "Архив",
  blacklist: "Чёрный список",
  all: "Все",
}

const TAB_ORDER: ContactsTabKey[] = [
  "leads",
  "active",
  "churned",
  "potential",
  "archived",
  "blacklist",
  "nontarget",
  "all",
]

const NO_ACTIVE_APP: Prisma.ClientWhereInput = {
  applications: { none: { status: "active", deletedAt: null } },
}

function buildWhere(tab: ContactsTabKey, tenantId: string): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { tenantId, deletedAt: null }
  if (tab === "leads") {
    base.funnelStatus = "new"
    base.AND = [NO_ACTIVE_APP, { payments: { none: {} } }]
  } else if (tab === "potential") {
    base.funnelStatus = "potential"
    base.AND = [NO_ACTIVE_APP]
  } else if (tab === "nontarget") {
    base.funnelStatus = "non_target"
  } else if (tab === "active") {
    base.AND = [
      { subscriptions: { some: { status: "active", deletedAt: null } } },
      NO_ACTIVE_APP,
      { funnelStatus: { notIn: ["archived", "blacklisted"] } },
    ]
  } else if (tab === "churned") {
    base.clientStatus = "churned"
    base.subscriptions = { none: { status: "active", deletedAt: null } }
  } else if (tab === "archived") {
    base.funnelStatus = "archived"
  } else if (tab === "blacklist") {
    base.funnelStatus = "blacklisted"
  }
  return base
}

async function countTab(tab: ContactsTabKey, tenantId: string): Promise<number> {
  return db.client.count({ where: buildWhere(tab, tenantId) })
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { tab: rawTab, q: rawQ } = await searchParams
  const tab: ContactsTabKey = TAB_ORDER.includes(rawTab as ContactsTabKey)
    ? (rawTab as ContactsTabKey)
    : "leads"
  const query = (rawQ ?? "").trim()

  const role = session.user.role

  const [branches, employees, ...countsArr] = await Promise.all([
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
    ...TAB_ORDER.map((t) => countTab(t, tenantId)),
  ])

  const counts = new Map<ContactsTabKey, number>()
  TAB_ORDER.forEach((t, i) => counts.set(t, countsArr[i] as number))

  const baseWhere = buildWhere(tab, tenantId)
  let where: Prisma.ClientWhereInput = baseWhere
  if (query) {
    // Поиск-по-токенам: каждое слово запроса должно совпасть с одним из полей
    // (имя/фамилия родителя или ребёнка). Иначе «Фамилия Имя» не находилось,
    // потому что в одном поле такой подстроки нет.
    const tokens = query.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    const digits = query.replace(/\D/g, "")
    const tokenClauses: Prisma.ClientWhereInput[] = tokens.map((token) => ({
      OR: [
        { firstName: { contains: token, mode: "insensitive" } },
        { lastName: { contains: token, mode: "insensitive" } },
        {
          wards: {
            some: {
              OR: [
                { firstName: { contains: token, mode: "insensitive" } },
                { lastName: { contains: token, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    }))
    const altOr: Prisma.ClientWhereInput[] = []
    if (tokenClauses.length > 0) altOr.push({ AND: tokenClauses })
    if (digits) altOr.push({ phone: { contains: digits } })
    where = { AND: [baseWhere, { OR: altOr }] }
  }
  const clients = await db.client.findMany({
    where,
    include: {
      wards: true,
      branch: { select: { id: true, name: true } },
      channel: { select: { id: true, name: true } },
      subscriptions: {
        where: { status: "active", deletedAt: null },
        take: 1,
        orderBy: { startDate: "desc" },
        include: {
          direction: { select: { id: true, name: true } },
          group: {
            select: {
              id: true,
              name: true,
              branch: { select: { id: true, name: true } },
              instructor: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
    orderBy: [{ nextContactDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
  })

  const rows: ContactRow[] = clients.map((c) => {
    const sub = c.subscriptions[0]
    const instrName = sub?.group?.instructor
      ? [sub.group.instructor.lastName, sub.group.instructor.firstName].filter(Boolean).join(" ") || "—"
      : "—"
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: maskPhone(c.phone, role),
      socialLink: c.socialLink,
      segment: c.segment,
      channelName: c.channel?.name ?? null,
      branchName: c.branch?.name ?? sub?.group?.branch?.name ?? null,
      funnelStatus: c.funnelStatus,
      clientStatus: c.clientStatus,
      comment: c.comment,
      nextContactDate: c.nextContactDate ? c.nextContactDate.toISOString() : null,
      assignedTo: c.assignedTo,
      createdAt: c.createdAt.toISOString(),
      wards: c.wards.map((w) => ({
        id: w.id,
        firstName: w.firstName,
        lastName: w.lastName,
        birthDate: w.birthDate ? w.birthDate.toISOString() : null,
      })),
      activeSubscription: sub
        ? {
            directionName: sub.direction.name,
            groupName: sub.group.name,
            branchName: sub.group.branch?.name ?? null,
            instructor: { id: sub.group.instructor?.id ?? null, name: instrName },
          }
        : null,
      hasActiveSubscription: c.subscriptions.length > 0,
    }
  })

  const tabs: ContactsTab[] = TAB_ORDER.map((t) => ({
    value: t,
    label: TAB_LABELS[t],
    count: counts.get(t) ?? 0,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Контакты</h1>
          <PageHelp pageKey="crm/contacts" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/crm/duplicates" />}>
            <Copy className="mr-2 size-4" />
            Дубликаты
          </Button>
          <CreateClientDialog branches={branches} />
        </div>
      </div>

      <ContactsTabs tabs={tabs} current={tab} />

      <ContactsTable tab={tab} rows={rows} employees={employees} initialQuery={query} />

      <QuickLeadButton />
    </div>
  )
}
