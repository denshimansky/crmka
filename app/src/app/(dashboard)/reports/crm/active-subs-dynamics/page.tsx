import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import { branchScopeFromSession, scopeSubscription } from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import {
  ActiveSubsTable,
  type ActiveSubsData,
  type DirectionRow,
  type DirectionAgg,
} from "./active-subs-table"

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])))
  return isNaN(d.getTime()) ? null : d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatPeriodLabel(mode: "month" | "range", year: number, month: number, from: Date, to: Date): string {
  if (mode === "month") {
    return `${MONTH_NAMES[month]} ${String(year).slice(2)}`
  }
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(2)}`
  return `${fmt(from)} — ${fmt(to)}`
}

export default async function ActiveSubsDynamicsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const sp = await searchParams

  const now = new Date()
  const rawMode = typeof sp.mode === "string" ? sp.mode : "month"
  const mode: "month" | "range" = rawMode === "range" ? "range" : "month"

  const year = typeof sp.year === "string" ? parseInt(sp.year, 10) || now.getUTCFullYear() : now.getUTCFullYear()
  const month = typeof sp.month === "string" ? parseInt(sp.month, 10) || (now.getUTCMonth() + 1) : (now.getUTCMonth() + 1)

  let dateFrom: Date
  let dateTo: Date
  if (mode === "range") {
    dateFrom = parseIsoDate(typeof sp.from === "string" ? sp.from : undefined) ??
      new Date(Date.UTC(year, month - 1, 1))
    const toRaw = parseIsoDate(typeof sp.to === "string" ? sp.to : undefined) ??
      new Date(Date.UTC(year, month, 0))
    dateTo = new Date(Date.UTC(
      toRaw.getUTCFullYear(),
      toRaw.getUTCMonth(),
      toRaw.getUTCDate(),
      23, 59, 59,
    ))
  } else {
    dateFrom = new Date(Date.UTC(year, month - 1, 1))
    dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59))
  }

  const branchId = typeof sp.branchId === "string" && sp.branchId ? sp.branchId : undefined

  // Справочники для фильтров
  const branches = await db.branch.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(scope.mode === "limited" ? { id: { in: scope.branchIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Условие по филиалу (через group.branchId)
  const branchClause = branchId
    ? { group: { branchId } }
    : scope.mode === "limited"
      ? { group: { branchId: { in: scope.branchIds } } }
      : {}

  // 1. Созданные в периоде (по startDate)
  const createdInPeriod = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      startDate: { gte: dateFrom, lte: dateTo },
      ...branchClause,
    },
    select: {
      id: true,
      directionId: true,
      previousSubscriptionId: true,
      direction: { select: { name: true } },
      group: { select: { branchId: true, branch: { select: { name: true } } } },
    },
  })

  // 2. Активные на конец периода (status active/pending, период покрывает dateTo)
  const activeOnEnd = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["active", "pending"] },
      startDate: { lte: dateTo },
      OR: [{ endDate: null }, { endDate: { gte: dateTo } }],
      ...branchClause,
    },
    select: {
      id: true,
      directionId: true,
      direction: { select: { name: true } },
      group: { select: { branchId: true, branch: { select: { name: true } } } },
    },
  })

  interface BranchBucket {
    id: string
    name: string
    directions: Map<string, {
      id: string
      name: string
      created: number
      renewed: number
      activeOnEnd: number
    }>
    agg: DirectionAgg
  }

  const branchMap = new Map<string, BranchBucket>()

  function getBucket(b: { id: string; name: string }): BranchBucket {
    let bucket = branchMap.get(b.id)
    if (!bucket) {
      bucket = {
        id: b.id,
        name: b.name,
        directions: new Map(),
        agg: { created: 0, renewed: 0, activeOnEnd: 0 },
      }
      branchMap.set(b.id, bucket)
    }
    return bucket
  }

  function getDir(bucket: BranchBucket, d: { id: string; name: string }) {
    let dir = bucket.directions.get(d.id)
    if (!dir) {
      dir = { id: d.id, name: d.name, created: 0, renewed: 0, activeOnEnd: 0 }
      bucket.directions.set(d.id, dir)
    }
    return dir
  }

  for (const s of createdInPeriod) {
    const bucket = getBucket({ id: s.group.branchId, name: s.group.branch.name })
    const dir = getDir(bucket, { id: s.directionId, name: s.direction.name })
    dir.created += 1
    bucket.agg.created += 1
    if (s.previousSubscriptionId) {
      dir.renewed += 1
      bucket.agg.renewed += 1
    }
  }

  for (const s of activeOnEnd) {
    const bucket = getBucket({ id: s.group.branchId, name: s.group.branch.name })
    const dir = getDir(bucket, { id: s.directionId, name: s.direction.name })
    dir.activeOnEnd += 1
    bucket.agg.activeOnEnd += 1
  }

  // Подключаем филиалы без данных, чтобы они тоже отображались (пустые строки)
  for (const b of branches) {
    getBucket(b)
  }

  const total: DirectionAgg = { created: 0, renewed: 0, activeOnEnd: 0 }
  for (const b of branchMap.values()) {
    total.created += b.agg.created
    total.renewed += b.agg.renewed
    total.activeOnEnd += b.agg.activeOnEnd
  }

  const data: ActiveSubsData = {
    total,
    branches: [...branchMap.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((b) => ({
        id: b.id,
        name: b.name,
        agg: b.agg,
        directions: [...b.directions.values()]
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map<DirectionRow>((d) => ({
            id: d.id,
            name: d.name,
            created: d.created,
            renewed: d.renewed,
            activeOnEnd: d.activeOnEnd,
          })),
      })),
  }

  // suppress unused warning for scopeSubscription (используется через branchClause выше неявно)
  void scopeSubscription

  const periodLabel = formatPeriodLabel(mode, year, month, dateFrom, dateTo)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Активные абонементы (динамика)</h1>
            <PageHelp pageKey="reports/crm/active-subs-dynamics" />
          </div>
          <p className="text-sm text-muted-foreground">
            Период: {periodLabel}
          </p>
        </div>
      </div>

      {data.branches.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет филиалов
          </CardContent>
        </Card>
      ) : (
        <ActiveSubsTable
          data={data}
          mode={mode}
          year={year}
          month={month}
          from={toIsoDate(dateFrom)}
          to={toIsoDate(new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate())))}
          branchId={branchId ?? ""}
          periodLabel={periodLabel}
          filterOptions={{ branches }}
        />
      )}
    </div>
  )
}
