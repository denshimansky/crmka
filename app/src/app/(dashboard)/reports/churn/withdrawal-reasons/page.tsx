import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { branchScopeFromSession, scopeBranch } from "@/lib/branch-scope"
import { ArrowLeft } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { WithdrawalReasonsView, type SummaryRow, type DetailRow } from "./report-view"
import type { Prisma } from "@prisma/client"

// Отчисления без выбранной причины сводим в отдельную строку/бакет.
const NO_REASON_LABEL = "Без причины"

function clientName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
}

// key = "YYYY-MM-DD" → "DD.MM"
function dayLabel(key: string): string {
  const [, m, d] = key.split("-")
  return `${d}.${m}`
}

export default async function WithdrawalReasonsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const sp = await searchParams

  const { year, month } = getMonthFromParams(sp)
  // withdrawalDate — @db.Date, поэтому границы месяца строим в UTC-полночь.
  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateToExclusive = new Date(Date.UTC(year, month, 1))

  const branchIdParam =
    typeof sp.branchId === "string" && sp.branchId ? sp.branchId : ""

  // Филиалы для фильтра — с учётом scope (ADM-04): скоуп-админ видит только свои.
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Разрез по филиалу ГРУППЫ абонемента — как во всех churn-отчётах по абонементам
  // (у Subscription своего branchId нет; scopeSubscription тоже идёт по group.branchId).
  // Явно выбранный филиал пересекаем со scope: чужой branchId из URL → пустая выборка.
  const groupWhere: Prisma.GroupWhereInput = {}
  if (scope.mode === "limited") {
    if (branchIdParam) {
      groupWhere.branchId = scope.branchIds.includes(branchIdParam)
        ? branchIdParam
        : { in: [] }
    } else {
      groupWhere.branchId = { in: scope.branchIds }
    }
  } else if (branchIdParam) {
    groupWhere.branchId = branchIdParam
  }

  const subWhere: Prisma.SubscriptionWhereInput = {
    tenantId,
    deletedAt: null,
    status: "withdrawn",
    withdrawalDate: { gte: dateFrom, lt: dateToExclusive },
    // Абонемент без платных занятий НЕ считается оттоком (правило заказчика): его
    // дата отчисления = дата создания (не последнего платного занятия), и в отток
    // он попадать не должен — ребёнок фактически даже не был зачислён. Тот же
    // фильтр, что в остальных churn-отчётах (см. churn-details/route.ts).
    chargedAmount: { gt: 0 },
  }
  if (Object.keys(groupWhere).length > 0) subWhere.group = groupWhere

  // Считаем ПО АБОНЕМЕНТАМ: 1 выбывший абонемент = 1 отчисление. Причина — с
  // абонемента (Subscription.withdrawalReason), а не с клиента.
  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      withdrawalDate: true,
      withdrawalReason: { select: { name: true } },
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: { select: { branch: { select: { name: true } } } },
    },
    orderBy: { withdrawalDate: "desc" },
  })

  // === Сводная матрица: причина × день ===
  // Столбцы — только дни, где были отчисления. Строки — только встретившиеся
  // причины; «Без причины» отдельным бакетом.
  const dayKeys = new Set<string>()
  const matrix = new Map<string, Map<string, number>>() // reason → (dayKey → count)
  for (const s of subs) {
    if (!s.withdrawalDate) continue // status=withdrawn всегда с датой — страховка
    const key = s.withdrawalDate.toISOString().slice(0, 10)
    dayKeys.add(key)
    const reason = s.withdrawalReason?.name ?? NO_REASON_LABEL
    let row = matrix.get(reason)
    if (!row) {
      row = new Map()
      matrix.set(reason, row)
    }
    row.set(key, (row.get(key) ?? 0) + 1)
  }

  const days = Array.from(dayKeys)
    .sort()
    .map((key) => ({ key, label: dayLabel(key) }))

  const summaryRows: SummaryRow[] = Array.from(matrix.entries())
    .map(([reason, byDay]) => {
      const counts = days.map((d) => byDay.get(d.key) ?? 0)
      const total = counts.reduce((a, b) => a + b, 0)
      return { reason, isNoReason: reason === NO_REASON_LABEL, counts, total }
    })
    // Сортировка: по убыванию итога; «Без причины» всегда последней.
    .sort((a, b) => {
      if (a.isNoReason !== b.isNoReason) return a.isNoReason ? 1 : -1
      if (b.total !== a.total) return b.total - a.total
      return a.reason.localeCompare(b.reason, "ru")
    })

  const columnTotals = days.map((_, i) =>
    summaryRows.reduce((sum, r) => sum + r.counts[i], 0),
  )
  const grandTotal = columnTotals.reduce((a, b) => a + b, 0)

  // === Детализация: одна строка = один выбывший абонемент (сходится со сводной) ===
  const detailRows: DetailRow[] = subs
    .map((s) => {
      const key = s.withdrawalDate
        ? s.withdrawalDate.toISOString().slice(0, 10)
        : ""
      return {
        id: s.id,
        clientId: s.client.id,
        clientName: clientName(s.client),
        branch: s.group?.branch?.name ?? "Без филиала",
        direction: s.direction?.name ?? "—",
        reason: s.withdrawalReason?.name ?? NO_REASON_LABEL,
        date: key ? dayLabel(key) : "—",
        dateKey: key,
      }
    })
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1 // дата ↓
      const c = a.branch.localeCompare(b.branch, "ru")
      if (c !== 0) return c
      return a.clientName.localeCompare(b.clientName, "ru")
    })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton
          fallbackHref="/reports"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Сводный по причинам отчисления</h1>
            <PageHelp pageKey="reports/churn/withdrawal-reasons" />
          </div>
          <p className="text-sm text-muted-foreground">
            Отчисленные абонементы по причинам и дням месяца
          </p>
        </div>
        <MonthPicker />
      </div>

      <WithdrawalReasonsView
        days={days}
        summaryRows={summaryRows}
        columnTotals={columnTotals}
        grandTotal={grandTotal}
        detailRows={detailRows}
        branches={branches}
        branchId={branchIdParam}
        withdrawnCount={grandTotal}
        reasonsCount={matrix.size}
      />
    </div>
  )
}
