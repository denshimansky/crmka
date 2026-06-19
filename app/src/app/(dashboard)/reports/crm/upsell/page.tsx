import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, TrendingUp } from "lucide-react"
import Link from "next/link"
import { UpsellTabs } from "./upsell-tabs"
import { UpsellFilters } from "./upsell-filters"

export default async function UpsellReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const sp = await searchParams
  const { year, month } = getMonthFromParams(sp)
  const branchId = typeof sp.branchId === "string" ? sp.branchId : undefined
  const directionId = typeof sp.directionId === "string" ? sp.directionId : undefined
  const groupId = typeof sp.groupId === "string" ? sp.groupId : undefined

  const now = new Date()
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // Previous month
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  // Branches for filter
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Направления и группы для верхних фильтров. Группы сужаем по выбранному
  // филиалу/направлению — чтобы в выпадающем списке оставались валидные комбинации.
  const directions = await db.direction.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  const groups = await db.group.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isOneTime: false,
      ...(branchId ? { branchId } : {}),
      ...(directionId ? { directionId } : {}),
    },
    select: { id: true, name: true, directionId: true, direction: { select: { name: true } } },
    orderBy: { name: "asc" },
  })

  // Current month active subscriptions
  const activeSubsAll = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: "active",
      periodYear: year,
      periodMonth: month,
    },
    select: {
      id: true,
      clientId: true,
      directionId: true,
      finalAmount: true,
      endDate: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          branchId: true,
          comment: true,
        },
      },
      direction: { select: { name: true } },
      group: { select: { id: true, name: true } },
    },
  })

  const activeSubs = branchId
    ? activeSubsAll.filter((s) => s.client.branchId === branchId)
    : activeSubsAll

  // Group by client
  const subsByClient = new Map<string, typeof activeSubs>()
  for (const sub of activeSubs) {
    const list = subsByClient.get(sub.clientId) || []
    list.push(sub)
    subsByClient.set(sub.clientId, list)
  }

  // ── Tab 1: Single direction ──
  const singleDirection: Array<{
    clientId: string
    clientName: string
    phone: string
    comment: string | null
    direction: string
    directionId: string
    group: string
    // Все группы клиента в этом направлении (у родителя может быть несколько детей
    // в разных группах одного направления) — чтобы фильтр по группе не скрывал клиента.
    groupIds: string[]
    amount: number
  }> = []

  for (const [clientId, subs] of subsByClient) {
    const uniqueDirections = new Set(subs.map((s) => s.directionId))
    if (uniqueDirections.size === 1) {
      const sub = subs[0]
      singleDirection.push({
        clientId,
        clientName:
          [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
        phone: sub.client.phone || "—",
        comment: sub.client.comment,
        direction: sub.direction.name,
        directionId: sub.directionId,
        group: sub.group.name,
        groupIds: Array.from(new Set(subs.map((s) => s.group.id))),
        amount: Number(sub.finalAmount),
      })
    }
  }

  // ── Tab 2: Expiring within 2 weeks ──
  const expiringMap = new Map<
    string,
    {
      clientId: string
      clientName: string
      phone: string
      comment: string | null
      direction: string
      directionId: string
      group: string
      groupIds: string[]
      amount: number
      endDate: string
    }
  >()

  for (const sub of activeSubs) {
    let endDate: Date | null = null

    if (sub.endDate) {
      endDate = new Date(sub.endDate)
    } else {
      // Calendar subscription — month end
      endDate = new Date(Date.UTC(year, month, 0))
    }

    if (endDate && endDate <= twoWeeksFromNow && endDate >= now) {
      const key = `${sub.clientId}:${sub.directionId}`
      const existing = expiringMap.get(key)
      if (existing) {
        // Накапливаем все группы клиента в этом направлении (см. groupIds выше),
        // чтобы фильтр по группе не терял клиента с несколькими истекающими группами.
        if (!existing.groupIds.includes(sub.group.id)) existing.groupIds.push(sub.group.id)
      } else {
        expiringMap.set(key, {
          clientId: sub.clientId,
          clientName:
            [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
          phone: sub.client.phone || "—",
          comment: sub.client.comment,
          direction: sub.direction.name,
          directionId: sub.directionId,
          group: sub.group.name,
          groupIds: [sub.group.id],
          amount: Number(sub.finalAmount),
          endDate: endDate.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }),
        })
      }
    }
  }
  const expiring = Array.from(expiringMap.values())

  // ── Tab 3: Reduced activity vs previous month ──
  const prevMonthSubsAll = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: prevYear,
      periodMonth: prevMonth,
      status: { in: ["active", "closed"] },
    },
    select: {
      clientId: true,
      directionId: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          branchId: true,
          comment: true,
        },
      },
      direction: { select: { name: true } },
    },
  })

  const prevMonthSubs = branchId
    ? prevMonthSubsAll.filter((s) => s.client.branchId === branchId)
    : prevMonthSubsAll

  // Prev month: directions per client
  const prevDirsByClient = new Map<string, Map<string, string>>()
  const prevClientInfo = new Map<string, { name: string; phone: string; comment: string | null }>()
  for (const sub of prevMonthSubs) {
    if (!prevDirsByClient.has(sub.clientId)) {
      prevDirsByClient.set(sub.clientId, new Map())
    }
    prevDirsByClient.get(sub.clientId)!.set(sub.directionId, sub.direction.name)
    if (!prevClientInfo.has(sub.clientId)) {
      prevClientInfo.set(sub.clientId, {
        name:
          [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
        phone: sub.client.phone || "—",
        comment: sub.client.comment,
      })
    }
  }

  // Current month: directions per client
  const currDirsByClient = new Map<string, Set<string>>()
  for (const sub of activeSubs) {
    const dirs = currDirsByClient.get(sub.clientId) || new Set()
    dirs.add(sub.directionId)
    currDirsByClient.set(sub.clientId, dirs)
  }

  const reducedActivity: Array<{
    clientId: string
    clientName: string
    phone: string
    comment: string | null
    prevCount: number
    currentCount: number
    lostDirections: string
    lostDirectionIds: string[]
  }> = []

  for (const [clientId, prevDirs] of prevDirsByClient) {
    const currDirs = currDirsByClient.get(clientId)
    const currCount = currDirs ? currDirs.size : 0

    if (currCount < prevDirs.size) {
      const info = prevClientInfo.get(clientId)!
      const lost: string[] = []
      const lostIds: string[] = []
      for (const [dirId, dirName] of prevDirs) {
        if (!currDirs || !currDirs.has(dirId)) {
          lost.push(dirName)
          lostIds.push(dirId)
        }
      }

      reducedActivity.push({
        clientId,
        clientName: info.name,
        phone: info.phone,
        comment: info.comment,
        prevCount: prevDirs.size,
        currentCount: currCount,
        lostDirections: lost.join(", "),
        lostDirectionIds: lostIds,
      })
    }
  }

  reducedActivity.sort(
    (a, b) => b.prevCount - b.currentCount - (a.prevCount - a.currentCount)
  )

  // ── Верхние фильтры по направлению/группе (применяются к выводу) ──
  // Вкладки «Одно направление» и «Скоро истекает» фильтруются по направлению и
  // группе строки. «Снизили активность» — по направлению (среди потерянных): если
  // выбрана группа, берём направление этой группы (у группы одно направление).
  const selectedGroupDir = groupId ? groups.find((g) => g.id === groupId)?.directionId : undefined
  const effectiveDir = directionId || selectedGroupDir

  const matchDirGroup = (r: { directionId: string; groupIds: string[] }) =>
    (!directionId || r.directionId === directionId) && (!groupId || r.groupIds.includes(groupId))

  const singleDirectionF = singleDirection.filter(matchDirGroup)
  const expiringF = expiring.filter(matchDirGroup)
  const reducedActivityF = reducedActivity.filter(
    (r) => !effectiveDir || r.lostDirectionIds.includes(effectiveDir),
  )

  const totalOpportunities =
    singleDirectionF.length + expiringF.length + reducedActivityF.length

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  })

  // Ссылка фильтра по филиалу с сохранением месяца и направления. Группу НЕ сохраняем:
  // группа привязана к одному филиалу, и при смене филиала прошлый groupId стал бы
  // «фантомным» (вкладки пусты, выпадашка рассинхронена). Направление к филиалу не
  // привязано, поэтому переносится.
  const filterHref = (over: { branchId?: string | null }) => {
    const params = new URLSearchParams()
    params.set("year", String(year))
    params.set("month", String(month))
    const bid = over.branchId === undefined ? branchId : over.branchId ?? undefined
    if (bid) params.set("branchId", bid)
    if (directionId) params.set("directionId", directionId)
    return `/reports/crm/upsell?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Допродажи</h1>
            <PageHelp pageKey="reports/crm/upsell" />
          </div>
          <p className="text-sm text-muted-foreground">
            Возможности для допродаж и удержания клиентов
          </p>
        </div>
        <MonthPicker />
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего возможностей</p>
            <p className="text-2xl font-bold">{totalOpportunities}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Одно направление</p>
            <p className="text-2xl font-bold text-blue-600">{singleDirectionF.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Скоро истекает</p>
            <p className="text-2xl font-bold text-orange-600">{expiringF.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Снизили активность</p>
            <p className="text-2xl font-bold text-red-600">{reducedActivityF.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters: филиал (бейджи) + направление и группа (выпадающие списки) */}
      <div className="flex flex-wrap items-center gap-3">
        {branches.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <Link href={filterHref({ branchId: null })}>
              <Badge variant={!branchId ? "default" : "outline"}>Все филиалы</Badge>
            </Link>
            {branches.map((b) => (
              <Link key={b.id} href={filterHref({ branchId: b.id })}>
                <Badge variant={branchId === b.id ? "default" : "outline"}>{b.name}</Badge>
              </Link>
            ))}
          </div>
        )}
        <UpsellFilters
          directions={directions}
          groups={groups.map((g) => ({ id: g.id, name: g.name, directionName: g.direction.name }))}
          directionId={directionId}
          groupId={groupId}
        />
      </div>

      {/* Tabs with data */}
      <UpsellTabs
        singleDirection={singleDirectionF}
        expiring={expiringF}
        reducedActivity={reducedActivityF}
        monthName={monthName}
      />
    </div>
  )
}
