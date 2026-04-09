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
        },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
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
    direction: string
    group: string
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
        direction: sub.direction.name,
        group: sub.group.name,
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
      direction: string
      group: string
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
      if (!expiringMap.has(key)) {
        expiringMap.set(key, {
          clientId: sub.clientId,
          clientName:
            [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
          phone: sub.client.phone || "—",
          direction: sub.direction.name,
          group: sub.group.name,
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
  const prevClientInfo = new Map<string, { name: string; phone: string }>()
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
    prevCount: number
    currentCount: number
    lostDirections: string
  }> = []

  for (const [clientId, prevDirs] of prevDirsByClient) {
    const currDirs = currDirsByClient.get(clientId)
    const currCount = currDirs ? currDirs.size : 0

    if (currCount < prevDirs.size) {
      const info = prevClientInfo.get(clientId)!
      const lost: string[] = []
      for (const [dirId, dirName] of prevDirs) {
        if (!currDirs || !currDirs.has(dirId)) {
          lost.push(dirName)
        }
      }

      reducedActivity.push({
        clientId,
        clientName: info.name,
        phone: info.phone,
        prevCount: prevDirs.size,
        currentCount: currCount,
        lostDirections: lost.join(", "),
      })
    }
  }

  reducedActivity.sort(
    (a, b) => b.prevCount - b.currentCount - (a.prevCount - a.currentCount)
  )

  const totalOpportunities =
    singleDirection.length + expiring.length + reducedActivity.length

  const selectedBranchName = branchId
    ? branches.find((b) => b.id === branchId)?.name || "—"
    : "Все"

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  })

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
            <p className="text-2xl font-bold text-blue-600">{singleDirection.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Скоро истекает</p>
            <p className="text-2xl font-bold text-orange-600">{expiring.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Снизили активность</p>
            <p className="text-2xl font-bold text-red-600">{reducedActivity.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Branch filter */}
      {branches.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/reports/crm/upsell?year=${year}&month=${month}`}>
            <Badge variant={!branchId ? "default" : "outline"}>Все филиалы</Badge>
          </Link>
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/reports/crm/upsell?branchId=${b.id}&year=${year}&month=${month}`}
            >
              <Badge variant={branchId === b.id ? "default" : "outline"}>{b.name}</Badge>
            </Link>
          ))}
        </div>
      )}

      {/* Tabs with data */}
      <UpsellTabs
        singleDirection={singleDirection}
        expiring={expiring}
        reducedActivity={reducedActivity}
        monthName={monthName}
      />
    </div>
  )
}
