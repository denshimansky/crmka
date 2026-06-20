import { PageHelp } from "@/components/page-help"
import { getSession } from "@/lib/session"
import {
  branchScopeFromSession,
  scopeApplication,
  scopeSubscription,
  scopeTrialLesson,
} from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { Prisma } from "@prisma/client"
import {
  ConversionByDaysTable,
  type TabData,
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

// Группировка событий по дню (UTC). Возвращает Map "дд/мм" → количество.
function byDay(events: { d: Date }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) {
    const utc = new Date(Date.UTC(e.d.getUTCFullYear(), e.d.getUTCMonth(), e.d.getUTCDate()))
    const key = dayKey(utc)
    m.set(key, (m.get(key) || 0) + 1)
  }
  return m
}

function sortDays(maps: Map<string, number>[]): string[] {
  const daySet = new Set<string>()
  for (const m of maps) for (const k of m.keys()) daySet.add(k)
  return [...daySet].sort((a, b) => {
    const [d1, mo1] = a.split("/").map(Number)
    const [d2, mo2] = b.split("/").map(Number)
    return mo1 === mo2 ? d1 - d2 : mo1 - mo2
  })
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

  // === 1. Создано заявок (Application.createdAt) с ≥1 пробным занятием ===
  const applications = await db.application.findMany({
    where: {
      tenantId,
      deletedAt: null,
      createdAt: { gte: dateFrom, lte: dateTo },
      ...(branchId ? { branchId } : scopeApplication(scope)),
      ...(directionId ? { directionId } : {}),
      ...(hasClientFilter ? { client: clientFilter } : {}),
    },
    select: { id: true, createdAt: true, _count: { select: { trialLessons: true } } },
  })
  const appsWithTrial = applications.filter((a) => a._count.trialLessons > 0)

  // === 2. Записано на пробник (TrialLesson.scheduledDate) — только вкладка «С пробным» ===
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

  // === 3. Посетил пробник (TrialLesson.attendedAt) — только вкладка «С пробным» ===
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

  // === 4. Совершено продаж ===
  // Продажа = первый абонемент клиента (previousSubscriptionId=null). Дата продажи =
  // самая ранняя из {дата зачисления денег на абонемент; дата первого платного занятия}.
  // Абонемент без оплаты и без платного занятия — не считаем. Разделение по вкладкам:
  // было ли у подопечного пробное в направлении абонемента.
  const firstSubFilter: Prisma.SubscriptionWhereInput = {
    tenantId,
    deletedAt: null,
    previousSubscriptionId: null,
    ...(directionId ? { directionId } : {}),
    ...(branchId ? { group: { branchId } } : scopeSubscription(scope)),
    ...(hasClientFilter ? { client: clientFilter } : {}),
  }

  // Денежные события первых абонементов В ПЕРИОДЕ:
  //  - зачисление денег на абонемент: Payment incoming ИЛИ transfer_in (оплата с
  //    баланса родителя проводится как transfer_in — основной способ пополнения)
  //  - первое платное занятие (Attendance: непробное, не pending, chargeAmount>0 → Lesson.date)
  const [payInWindow, paidAttInWindow] = await Promise.all([
    db.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: { in: ["incoming", "transfer_in"] },
        date: { gte: dateFrom, lte: dateTo },
        subscription: { is: firstSubFilter },
      },
      select: { subscriptionId: true, date: true },
    }),
    db.attendance.findMany({
      where: {
        tenantId,
        isTrial: false,
        isPending: false,
        chargeAmount: { gt: 0 },
        subscription: { is: firstSubFilter },
        lesson: { date: { gte: dateFrom, lte: dateTo } },
      },
      select: { subscriptionId: true, lesson: { select: { date: true } } },
    }),
  ])

  // Самое раннее денежное событие в окне на каждый абонемент.
  const earliestInWindow = new Map<string, Date>()
  const consider = (id: string | null, d: Date) => {
    if (!id) return
    const cur = earliestInWindow.get(id)
    if (!cur || d < cur) earliestInWindow.set(id, d)
  }
  for (const p of payInWindow) consider(p.subscriptionId, p.date)
  for (const a of paidAttInWindow) consider(a.subscriptionId, a.lesson.date)

  const candidateIds = [...earliestInWindow.keys()]

  // Дата продажи ∈ [from,to] ⇔ самое раннее денежное событие в окне И нет более раннего
  // события до начала периода. Иначе продажа состоялась раньше — её здесь не считаем.
  let saleSubIds = candidateIds
  if (candidateIds.length > 0) {
    const [payBefore, attBefore] = await Promise.all([
      db.payment.findMany({
        where: {
          tenantId,
          deletedAt: null,
          type: { in: ["incoming", "transfer_in"] },
          date: { lt: dateFrom },
          subscriptionId: { in: candidateIds },
        },
        select: { subscriptionId: true },
      }),
      db.attendance.findMany({
        where: {
          tenantId,
          isTrial: false,
          isPending: false,
          chargeAmount: { gt: 0 },
          subscriptionId: { in: candidateIds },
          lesson: { date: { lt: dateFrom } },
        },
        select: { subscriptionId: true },
      }),
    ])
    const hasEarlier = new Set<string>()
    for (const p of payBefore) if (p.subscriptionId) hasEarlier.add(p.subscriptionId)
    for (const a of attBefore) if (a.subscriptionId) hasEarlier.add(a.subscriptionId)
    saleSubIds = candidateIds.filter((id) => !hasEarlier.has(id))
  }

  // Метаданные абонементов-продаж + признак пробного у подопечного в направлении.
  const subMeta = saleSubIds.length
    ? await db.subscription.findMany({
        where: { id: { in: saleSubIds } },
        select: { id: true, directionId: true, wardId: true, clientId: true },
      })
    : []

  const wardIds = [...new Set(subMeta.map((s) => s.wardId).filter((x): x is string => !!x))]
  const clientIds = [...new Set(subMeta.map((s) => s.clientId))]

  const trialsForSplit = subMeta.length
    ? await db.trialLesson.findMany({
        where: {
          tenantId,
          OR: [
            ...(wardIds.length ? [{ wardId: { in: wardIds } }] : []),
            { clientId: { in: clientIds } },
          ],
        },
        select: {
          wardId: true,
          clientId: true,
          directionId: true,
          group: { select: { directionId: true } },
        },
      })
    : []
  const trialWardDir = new Set<string>()
  const trialClientDir = new Set<string>()
  for (const t of trialsForSplit) {
    // Направление пробного: своё поле, иначе — направление группы пробного.
    // У большинства пробных directionId не заполнен, но есть группа — без этого
    // fallback совпадений по направлению почти нет и вкладка «С пробным» пустеет.
    const dir = t.directionId ?? t.group?.directionId
    if (!dir) continue
    if (t.wardId) trialWardDir.add(`${t.wardId}|${dir}`)
    trialClientDir.add(`${t.clientId}|${dir}`)
  }

  const salesWithTrial: { d: Date }[] = []
  const metaById = new Map(subMeta.map((s) => [s.id, s]))
  for (const id of saleSubIds) {
    const meta = metaById.get(id)
    const d = earliestInWindow.get(id)
    if (!meta || !d) continue
    // Признак «с пробным»: пробное у подопечного в направлении абонемента.
    // У абонемента без подопечного (взрослый клиент) — сопоставляем по клиенту.
    const hasTrial = meta.wardId
      ? trialWardDir.has(`${meta.wardId}|${meta.directionId}`)
      : trialClientDir.has(`${meta.clientId}|${meta.directionId}`)
    if (hasTrial) salesWithTrial.push({ d })
  }

  // === Сборка вкладок ===
  // Вкладка «С пробным» (полная воронка): создано → записано → посетил → продажа.
  const wtCreated = byDay(appsWithTrial.map((a) => ({ d: a.createdAt })))
  const wtScheduled = byDay(trialScheduled.map((t) => ({ d: t.scheduledDate })))
  const wtAttended = byDay(trialAttended.filter((t) => t.attendedAt).map((t) => ({ d: t.attendedAt! })))
  const wtSales = byDay(salesWithTrial)

  const totalWtCreated = appsWithTrial.length
  const totalWtScheduled = trialScheduled.length
  const totalWtAttended = trialAttended.filter((t) => t.attendedAt).length
  const totalWtSales = salesWithTrial.length

  const withTrialDays = sortDays([wtCreated, wtScheduled, wtAttended, wtSales])
  const withTrialMetrics: MetricRow[] = [
    {
      id: "applications",
      label: "Создано заявок",
      total: totalWtCreated,
      conversion: null,
      perDay: withTrialDays.map((d) => wtCreated.get(d) || 0),
    },
    {
      id: "trial_scheduled",
      label: "Записано на пробник",
      total: totalWtScheduled,
      conversion: pct(totalWtScheduled, totalWtCreated),
      perDay: withTrialDays.map((d) => wtScheduled.get(d) || 0),
    },
    {
      id: "trial_attended",
      label: "Посетил пробник",
      total: totalWtAttended,
      conversion: pct(totalWtAttended, totalWtScheduled),
      perDay: withTrialDays.map((d) => wtAttended.get(d) || 0),
    },
    {
      id: "sales",
      label: "Совершено продаж",
      total: totalWtSales,
      conversion: pct(totalWtSales, totalWtAttended),
      perDay: withTrialDays.map((d) => wtSales.get(d) || 0),
    },
  ]

  const withTrial: TabData = { days: withTrialDays, metrics: withTrialMetrics }

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

      <ConversionByDaysTable
        withTrial={withTrial}
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
    </div>
  )
}
