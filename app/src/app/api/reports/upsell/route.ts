import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  const now = new Date()
  const year = dateRange.dateFrom.getUTCFullYear()
  const month = dateRange.dateFrom.getUTCMonth() + 1

  // Previous month for "reduced activity" comparison
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  // Two weeks from now for expiring subscriptions
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // ── 1. Clients with only 1 active subscription (upsell to additional directions) ──
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

  // Filter by branch if needed
  const activeSubs = branchId
    ? activeSubsAll.filter((s) => s.client.branchId === branchId)
    : activeSubsAll

  // Group active subs by clientId
  const subsByClient = new Map<string, typeof activeSubs>()
  for (const sub of activeSubs) {
    const list = subsByClient.get(sub.clientId) || []
    list.push(sub)
    subsByClient.set(sub.clientId, list)
  }

  // Tab 1: single direction clients
  const singleDirection: Array<{
    clientId: string
    clientName: string
    phone: string | null
    direction: string
    group: string
    amount: number
    action: string
  }> = []

  for (const [clientId, subs] of subsByClient) {
    // Count unique directions
    const uniqueDirections = new Set(subs.map((s) => s.directionId))
    if (uniqueDirections.size === 1) {
      const sub = subs[0]
      singleDirection.push({
        clientId,
        clientName: [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
        phone: sub.client.phone || null,
        direction: sub.direction.name,
        group: sub.group.name,
        amount: Number(sub.finalAmount),
        action: "Предложить дополнительное направление",
      })
    }
  }

  // ── 2. Subscriptions expiring within 2 weeks ──
  const expiringSubs: Array<{
    clientId: string
    clientName: string
    phone: string | null
    direction: string
    group: string
    amount: number
    endDate: string | null
    action: string
  }> = []

  for (const sub of activeSubs) {
    if (sub.endDate) {
      const endDate = new Date(sub.endDate)
      if (endDate <= twoWeeksFromNow && endDate >= now) {
        expiringSubs.push({
          clientId: sub.clientId,
          clientName: [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
          phone: sub.client.phone || null,
          direction: sub.direction.name,
          group: sub.group.name,
          amount: Number(sub.finalAmount),
          endDate: endDate.toISOString(),
          action: "Продлить абонемент",
        })
      }
    } else {
      // Calendar subscription — check if current month is ending soon
      const monthEnd = new Date(Date.UTC(year, month, 0))
      if (monthEnd <= twoWeeksFromNow && monthEnd >= now) {
        // Check if next month subscription exists
        const nextMonth = month === 12 ? 1 : month + 1
        const nextYear = month === 12 ? year + 1 : year
        const hasNext = activeSubs.some(
          (s) =>
            s.clientId === sub.clientId &&
            s.directionId === sub.directionId
        )
        // We check against all subscriptions including next month
        expiringSubs.push({
          clientId: sub.clientId,
          clientName: [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
          phone: sub.client.phone || null,
          direction: sub.direction.name,
          group: sub.group.name,
          amount: Number(sub.finalAmount),
          endDate: monthEnd.toISOString(),
          action: "Продлить на следующий месяц",
        })
      }
    }
  }

  // Deduplicate expiring subs by clientId+directionId
  const expiringDeduped = Array.from(
    new Map(expiringSubs.map((s) => [`${s.clientId}:${s.direction}`, s])).values()
  )

  // ── 3. Clients who reduced subscriptions vs previous month ──
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

  // Count unique directions per client for prev month
  const prevDirsByClient = new Map<string, Set<string>>()
  const prevClientInfo = new Map<string, { name: string; phone: string | null }>()
  for (const sub of prevMonthSubs) {
    const dirs = prevDirsByClient.get(sub.clientId) || new Set()
    dirs.add(sub.directionId)
    prevDirsByClient.set(sub.clientId, dirs)
    if (!prevClientInfo.has(sub.clientId)) {
      prevClientInfo.set(sub.clientId, {
        name: [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ") || "Без имени",
        phone: sub.client.phone || null,
      })
    }
  }

  // Count unique directions per client for current month
  const currDirsByClient = new Map<string, Set<string>>()
  for (const sub of activeSubs) {
    const dirs = currDirsByClient.get(sub.clientId) || new Set()
    dirs.add(sub.directionId)
    currDirsByClient.set(sub.clientId, dirs)
  }

  // Find clients with prev directions names for lost directions
  const prevDirNames = new Map<string, Map<string, string>>()
  for (const sub of prevMonthSubs) {
    if (!prevDirNames.has(sub.clientId)) {
      prevDirNames.set(sub.clientId, new Map())
    }
    prevDirNames.get(sub.clientId)!.set(sub.directionId, sub.direction.name)
  }

  const reducedActivity: Array<{
    clientId: string
    clientName: string
    phone: string | null
    prevCount: number
    currentCount: number
    lostDirections: string[]
    action: string
  }> = []

  for (const [clientId, prevDirs] of prevDirsByClient) {
    const currDirs = currDirsByClient.get(clientId)
    const currCount = currDirs ? currDirs.size : 0

    if (currCount < prevDirs.size) {
      const info = prevClientInfo.get(clientId)!
      const lost: string[] = []
      const clientDirNames = prevDirNames.get(clientId)
      if (clientDirNames) {
        for (const dirId of prevDirs) {
          if (!currDirs || !currDirs.has(dirId)) {
            const dirName = clientDirNames.get(dirId)
            if (dirName) lost.push(dirName)
          }
        }
      }

      reducedActivity.push({
        clientId,
        clientName: info.name,
        phone: info.phone,
        prevCount: prevDirs.size,
        currentCount: currCount,
        lostDirections: lost,
        action: currCount === 0 ? "Вернуть клиента" : "Восстановить направления",
      })
    }
  }

  reducedActivity.sort((a, b) => (b.prevCount - b.currentCount) - (a.prevCount - a.currentCount))

  return NextResponse.json({
    singleDirection,
    expiring: expiringDeduped,
    reducedActivity,
    metadata: {
      singleDirectionCount: singleDirection.length,
      expiringCount: expiringDeduped.length,
      reducedActivityCount: reducedActivity.length,
      totalOpportunities: singleDirection.length + expiringDeduped.length + reducedActivity.length,
      year,
      month,
      prevYear,
      prevMonth,
      dateFrom: dateRange.dateFrom.toISOString(),
      dateTo: dateRange.dateTo.toISOString(),
    },
  })
}
