import { getSession, getBranchScope } from "@/lib/session"
import { PageHelp } from "@/components/page-help"
import { CreateClientDialog } from "../clients/create-client-dialog"
import { ContactsTabs, type ContactsTab } from "./contacts-tabs"
import { ContactsTable } from "./contacts-table"
import { ContactsExportButton } from "./contacts-export-button"
import { db } from "@/lib/db"
import { scopeBranch, isUnscoped } from "@/lib/branch-scope"
import {
  TAB_LABELS,
  TAB_ORDER,
  countTab,
  loadContactRows,
  parseTab,
} from "@/lib/clients/contacts-query"

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; branchId?: string }>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const { tab: rawTab, q: rawQ, branchId: rawBranchId } = await searchParams
  const tab = parseTab(rawTab)
  const query = (rawQ ?? "").trim()
  // ADM-04: явный фильтр по филиалу из URL пересекается с серверным scope.
  const rawBranch = rawBranchId && rawBranchId !== "all" ? rawBranchId : null
  const branchFilter =
    rawBranch && (isUnscoped(scope) || scope.branchIds.includes(rawBranch))
      ? rawBranch
      : null

  const role = session.user.role

  const [branches, employees, ...countsArr] = await Promise.all([
    db.branch.findMany({
      where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, role: { not: "readonly" } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    ...TAB_ORDER.map((t) => countTab(t, tenantId, scope, branchFilter)),
  ])

  // Название организации — в шапку файла выгрузки (нужно только владельцу).
  const org =
    role === "owner"
      ? await db.organization.findUnique({ where: { id: tenantId }, select: { name: true } })
      : null

  const counts = new Map<string, number>()
  TAB_ORDER.forEach((t, i) => counts.set(t, countsArr[i] as number))

  const rows = await loadContactRows({
    tenantId,
    scope,
    tab,
    query,
    branchFilter,
    role,
    instructorsSeePhones: session.user.instructorsSeePhones,
  })

  // Шапка файла выгрузки: организация + какие фильтры были применены, чтобы по
  // файлу было видно, что это срез вкладки, а не вся база.
  const orgName = org?.name ?? ""
  const filterNote =
    [
      query ? `поиск «${query}»` : null,
      branchFilter ? `филиал «${branches.find((b) => b.id === branchFilter)?.name ?? "—"}»` : null,
    ]
      .filter(Boolean)
      .join("; ") || undefined

  const tabs: ContactsTab[] = TAB_ORDER.map((t) => ({
    value: t,
    label: TAB_LABELS[t],
    count: counts.get(t) ?? 0,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <PageHelp pageKey="crm/contacts" />
        </div>
        <div className="flex items-center gap-2">
          {/* Выгрузка активной вкладки — ТОЛЬКО владельцу: это полный список
              клиентской базы одним файлом, и уносить его наружу может лишь тот,
              кто за базу отвечает. Данных сверх экрана файл не открывает. */}
          {role === "owner" && (
            <ContactsExportButton
              tab={tab}
              tabLabel={TAB_LABELS[tab]}
              employees={employees}
              orgName={orgName}
              filterNote={filterNote}
            />
          )}
          <CreateClientDialog />
        </div>
      </div>

      <ContactsTabs tabs={tabs} current={tab} />

      <ContactsTable
        tab={tab}
        rows={rows}
        employees={employees}
        initialQuery={query}
        branches={branches}
        branchId={branchFilter}
      />
    </div>
  )
}
