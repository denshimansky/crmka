import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.2. Расчёты с учениками */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    periodYear: year,
    periodMonth: month,
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      totalAmount: true,
      finalAmount: true,
      chargedAmount: true,
      balance: true,
      client: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { name: true } },
      payments: {
        where: { deletedAt: null, date: { gte: dateFrom, lte: dateTo } },
        select: { amount: true },
      },
    },
  })

  // We approximate beginning balance as: balance + chargedAmount - totalPaid
  const data = subs.map((s) => {
    const paidInPeriod = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    const planAmount = Number(s.finalAmount)
    const factAmount = Number(s.chargedAmount)
    const endBalance = Number(s.balance)
    // beginBalance = endBalance - paidInPeriod + factAmount (simplified)
    const beginBalance = endBalance - paidInPeriod + factAmount

    return {
      clientId: s.client.id,
      clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: s.direction.name,
      beginBalance: Math.round(beginBalance * 100) / 100,
      planCharge: planAmount,
      factCharge: factAmount,
      paidInPeriod,
      endBalance,
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalClients: subs.length,
      totalPlan: data.reduce((s, d) => s + d.planCharge, 0),
      totalFact: data.reduce((s, d) => s + d.factCharge, 0),
      totalPaid: data.reduce((s, d) => s + d.paidInPeriod, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
