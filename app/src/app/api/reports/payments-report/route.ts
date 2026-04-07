import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.1. Оплаты — подробный отчёт */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const subWhere: any = { tenantId, deletedAt: null }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  // Get subscriptions for the period
  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1
  subWhere.periodYear = year
  subWhere.periodMonth = month

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      totalLessons: true,
      totalAmount: true,
      finalAmount: true,
      balance: true,
      chargedAmount: true,
      discountAmount: true,
      lessonPrice: true,
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: {
        select: {
          name: true,
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
      payments: {
        where: { deletedAt: null, date: { gte: dateFrom, lte: dateTo } },
        select: { amount: true, method: true, date: true },
      },
    },
  })

  const data = subs.map((s) => {
    const paidInPeriod = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    const lastPayment = s.payments.length > 0
      ? s.payments.sort((a, b) => b.date.getTime() - a.date.getTime())[0]
      : null

    return {
      subscriptionId: s.id,
      clientId: s.client.id,
      clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: s.direction.name,
      group: s.group.name,
      instructor: [s.group.instructor.lastName, s.group.instructor.firstName].filter(Boolean).join(" "),
      totalLessons: s.totalLessons,
      subscriptionAmount: Number(s.totalAmount),
      finalAmount: Number(s.finalAmount),
      discountAmount: Number(s.discountAmount),
      paidInPeriod,
      balance: Number(s.balance),
      chargedAmount: Number(s.chargedAmount),
      lastPaymentDate: lastPayment?.date.toISOString() || null,
      lastPaymentMethod: lastPayment?.method || null,
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalSubscriptions: subs.length,
      totalPaid: data.reduce((s, d) => s + d.paidInPeriod, 0),
      totalCharged: data.reduce((s, d) => s + d.chargedAmount, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
