import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 2.3. Отток по месяцам — в какой месяц срока жизни чаще уходят */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  // Churned clients
  const where: any = {
    tenantId,
    deletedAt: null,
    clientStatus: "churned",
    withdrawalDate: { not: null },
  }
  if (branchId) where.branchId = branchId

  const churned = await db.client.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      saleDate: true,
      firstPaymentDate: true,
      firstPaidLessonDate: true,
      withdrawalDate: true,
    },
  })

  // For each churned client, find last paid lesson date
  const clientIds = churned.map((c) => c.id)
  const lastPaidLessons = await db.attendance.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      chargeAmount: { gt: 0 },
    },
    select: { clientId: true, lesson: { select: { date: true } } },
    orderBy: { lesson: { date: "desc" } },
  })

  const lastPaidMap = new Map<string, Date>()
  for (const a of lastPaidLessons) {
    if (!lastPaidMap.has(a.clientId)) {
      lastPaidMap.set(a.clientId, a.lesson.date)
    }
  }

  // Calculate churn month (lifetime month)
  const monthBuckets: Record<number, number> = {}
  for (const c of churned) {
    const saleDate = c.saleDate || c.firstPaymentDate || c.firstPaidLessonDate
    const lastPaidDate = lastPaidMap.get(c.id) || c.withdrawalDate
    if (!saleDate || !lastPaidDate) continue

    const diffMs = lastPaidDate.getTime() - saleDate.getTime()
    const diffMonths = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30)))

    monthBuckets[diffMonths] = (monthBuckets[diffMonths] || 0) + 1
  }

  const data = Object.entries(monthBuckets)
    .map(([month, count]) => ({ lifetimeMonth: Number(month), count }))
    .sort((a, b) => a.lifetimeMonth - b.lifetimeMonth)

  return NextResponse.json({
    data,
    metadata: {
      totalChurned: churned.length,
      withSaleDate: churned.filter((c) => c.saleDate || c.firstPaymentDate).length,
    },
  })
}
