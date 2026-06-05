import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import {
  branchScopeFromSession,
  scopeApplication,
  scopeSubscription,
  scopePayment,
  scopeTrialLesson,
} from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { Prisma } from "@prisma/client"
import {
  ConversionByDaysTable,
  type ConversionData,
  type MetricRow,
} from "./conversion-table"

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

function dayKey(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export default async function ConversionByDaysPage({
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

  const channelId = typeof sp.channelId === "string" && sp.channelId ? sp.channelId : undefined
  const responsibleId = typeof sp.responsibleId === "string" && sp.responsibleId ? sp.responsibleId : undefined
  const directionId = typeof sp.directionId === "string" && sp.directionId ? sp.directionId : undefined
  const branchId = typeof sp.branchId === "string" && sp.branchId ? sp.branchId : undefined

  // Справочники
  const [branches, directions, channels, employees] = await Promise.all([
    db.branch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(scope.mode === "limited" ? { id: { in: scope.branchIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.leadChannel.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ])

  // Фильтр через Client (channel + assignedTo)
  const clientFilter: Prisma.ClientWhereInput = {}
  if (channelId) clientFilter.channelId = channelId
  if (responsibleId) clientFilter.assignedTo = responsibleId
  const hasClientFilter = Object.keys(clientFilter).length > 0

  // === 1. Создано заявок (Application.createdAt) ===
  const applications = await db.application.findMany({
    where: {
      tenantId,
      deletedAt: null,
      createdAt: { gte: dateFrom, lte: dateTo },
      ...(branchId ? { branchId } : scopeApplication(scope)),
      ...(directionId ? { directionId } : {}),
      ...(hasClientFilter ? { client: clientFilter } : {}),
    },
    select: { id: true, createdAt: true },
  })

  // === 2. Записано на пробник (TrialLesson.scheduledDate) ===
  const trialScheduledWhere: Prisma.TrialLessonWhereInput = {
    tenantId,
    scheduledDate: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) trialScheduledWhere.directionId = directionId
  if (hasClientFilter) trialScheduledWhere.client = clientFilter
  if (branchId) {
    trialScheduledWhere.OR = [
      { group: { branchId } },
      { room: { branchId } },
      { AND: [{ groupId: null }, { roomId: null }] },
    ]
  } else {
    Object.assign(trialScheduledWhere, scopeTrialLesson(scope))
  }
  const trialScheduled = await db.trialLesson.findMany({
    where: trialScheduledWhere,
    select: { id: true, scheduledDate: true },
  })

  // === 3. Посетил пробник (TrialLesson.attendedAt) ===
  const trialAttendedWhere: Prisma.TrialLessonWhereInput = {
    tenantId,
    attendedAt: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) trialAttendedWhere.directionId = directionId
  if (hasClientFilter) trialAttendedWhere.client = clientFilter
  if (branchId) {
    trialAttendedWhere.OR = [
      { group: { branchId } },
      { room: { branchId } },
      { AND: [{ groupId: null }, { roomId: null }] },
    ]
  } else {
    Object.assign(trialAttendedWhere, scopeTrialLesson(scope))
  }
  const trialAttended = await db.trialLesson.findMany({
    where: trialAttendedWhere,
    select: { id: true, attendedAt: true },
  })

  // === 4. Совершено продаж (Subscription с previousSubscriptionId=null, startDate в периоде) ===
  const salesWhere: Prisma.SubscriptionWhereInput = {
    tenantId,
    deletedAt: null,
    previousSubscriptionId: null,
    startDate: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) salesWhere.directionId = directionId
  if (hasClientFilter) salesWhere.client = clientFilter
  if (branchId) salesWhere.group = { branchId }
  else Object.assign(salesWhere, scopeSubscription(scope))
  const sales = await db.subscription.findMany({
    where: salesWhere,
    select: { id: true, startDate: true },
  })

  // === 5. Поступила первая оплата (Payment.isFirstPayment, date в периоде) ===
  const paymentsWhere: Prisma.PaymentWhereInput = {
    tenantId,
    deletedAt: null,
    isFirstPayment: true,
    date: { gte: dateFrom, lte: dateTo },
  }
  if (directionId) {
    paymentsWhere.subscription = {
      directionId,
      ...(branchId ? { group: { branchId } } : {}),
    }
  } else if (branchId) {
    paymentsWhere.subscription = { group: { branchId } }
  } else {
    Object.assign(paymentsWhere, scopePayment(scope))
  }
  if (hasClientFilter) paymentsWhere.client = clientFilter
  const payments = await db.payment.findMany({
    where: paymentsWhere,
    select: { id: true, date: true },
  })

  // === Группировка по дню ===
  function byDay(events: { d: Date }[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const e of events) {
      const utc = new Date(Date.UTC(e.d.getUTCFullYear(), e.d.getUTCMonth(), e.d.getUTCDate()))
      const key = dayKey(utc)
      m.set(key, (m.get(key) || 0) + 1)
    }
    return m
  }

  const m1 = byDay(applications.map((a) => ({ d: a.createdAt })))
  const m2 = byDay(trialScheduled.map((t) => ({ d: t.scheduledDate })))
  const m3 = byDay(trialAttended.filter((t) => t.attendedAt).map((t) => ({ d: t.attendedAt! })))
  const m4 = byDay(sales.map((s) => ({ d: s.startDate })))
  const m5 = byDay(payments.map((p) => ({ d: p.date })))

  // Дни с хотя бы одним событием
  const daySet = new Set<string>([...m1.keys(), ...m2.keys(), ...m3.keys(), ...m4.keys(), ...m5.keys()])
  const days = [...daySet].sort((a, b) => {
    const [d1, mo1] = a.split("/").map(Number)
    const [d2, mo2] = b.split("/").map(Number)
    return mo1 === mo2 ? d1 - d2 : mo1 - mo2
  })

  const totalCreated = applications.length
  const totalScheduled = trialScheduled.length
  const totalAttended = trialAttended.filter((t) => t.attendedAt).length
  const totalSales = sales.length
  const totalPayments = payments.length

  const metrics: MetricRow[] = [
    {
      id: "applications",
      label: "Создано заявок",
      total: totalCreated,
      conversion: null,
      perDay: days.map((d) => m1.get(d) || 0),
    },
    {
      id: "trial_scheduled",
      label: "Записано на пробник",
      total: totalScheduled,
      conversion: pct(totalScheduled, totalCreated),
      perDay: days.map((d) => m2.get(d) || 0),
    },
    {
      id: "trial_attended",
      label: "Посетил пробник",
      total: totalAttended,
      conversion: pct(totalAttended, totalCreated),
      perDay: days.map((d) => m3.get(d) || 0),
    },
    {
      id: "sales",
      label: "Совершено продаж",
      total: totalSales,
      conversion: pct(totalSales, totalCreated),
      perDay: days.map((d) => m4.get(d) || 0),
    },
    {
      id: "payments",
      label: "Поступила оплата",
      total: totalPayments,
      conversion: pct(totalPayments, totalCreated),
      perDay: days.map((d) => m5.get(d) || 0),
    },
  ]

  const data: ConversionData = { days, metrics }

  const periodLabel = formatPeriodLabel(mode, year, month, dateFrom, dateTo)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Доходимость по дням</h1>
            <PageHelp pageKey="reports/crm/conversion-by-days" />
          </div>
          <p className="text-sm text-muted-foreground">
            Период: {periodLabel}
          </p>
        </div>
      </div>

      {days.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            За выбранный период нет данных
          </CardContent>
        </Card>
      ) : (
        <ConversionByDaysTable
          data={data}
          mode={mode}
          year={year}
          month={month}
          from={toIsoDate(dateFrom)}
          to={toIsoDate(new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate())))}
          channelId={channelId ?? ""}
          responsibleId={responsibleId ?? ""}
          directionId={directionId ?? ""}
          branchId={branchId ?? ""}
          periodLabel={periodLabel}
          filterOptions={{
            branches,
            directions,
            channels,
            employees: employees.map((e) => ({
              id: e.id,
              name: [e.lastName, e.firstName?.[0] ? `${e.firstName[0]}.` : ""]
                .filter(Boolean)
                .join(" ")
                .trim() || "—",
            })),
          }}
        />
      )}
    </div>
  )
}
