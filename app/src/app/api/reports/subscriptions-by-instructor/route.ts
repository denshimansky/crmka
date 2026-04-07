import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 7.6. Сводный по абонементам в разрезе педагогов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Current month subscriptions with group (instructor)
  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
  }
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      status: true,
      chargedAmount: true,
      createdAt: true,
      withdrawalDate: true,
      group: {
        select: {
          instructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
      client: { select: { saleDate: true, firstPaidLessonDate: true } },
    },
  })

  // Active = has charged amount > 0
  // New = saleDate AND first paid lesson in current month
  // Churned = has withdrawalDate in current month
  // Active at end = active and not churned

  const instrData = new Map<
    string,
    {
      name: string
      active: number
      new_subs: number
      churned: number
      activeAtEnd: number
    }
  >()

  for (const s of subs) {
    const iId = s.group.instructorId
    if (!instrData.has(iId)) {
      instrData.set(iId, {
        name: [s.group.instructor.lastName, s.group.instructor.firstName].filter(Boolean).join(" "),
        active: 0,
        new_subs: 0,
        churned: 0,
        activeAtEnd: 0,
      })
    }
    const d = instrData.get(iId)!

    const hasCharge = Number(s.chargedAmount) > 0
    if (hasCharge) d.active += 1

    // New: sale date in current month
    const isNew =
      s.client.saleDate &&
      s.client.saleDate >= dateFrom &&
      s.client.saleDate <= dateTo
    if (isNew) d.new_subs += 1

    // Churned
    const isChurned =
      s.withdrawalDate &&
      s.withdrawalDate >= dateFrom &&
      s.withdrawalDate <= dateTo
    if (isChurned) d.churned += 1

    // Active at end = has charge and not churned
    if (hasCharge && !isChurned) d.activeAtEnd += 1
  }

  const data = [...instrData.entries()]
    .map(([id, v]) => ({
      instructorId: id,
      instructorName: v.name,
      activeSubscriptions: v.active,
      newSubscriptions: v.new_subs,
      churned: v.churned,
      activeAtEnd: v.activeAtEnd,
    }))
    .sort((a, b) => b.activeSubscriptions - a.activeSubscriptions)

  return NextResponse.json({
    data,
    metadata: {
      year,
      month,
      totalActive: data.reduce((s, d) => s + d.activeSubscriptions, 0),
      totalNew: data.reduce((s, d) => s + d.newSubscriptions, 0),
      totalChurned: data.reduce((s, d) => s + d.churned, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
