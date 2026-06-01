import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.8. Работа с должниками */
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

  // Развилка по типу абонемента организации.
  // calendar: должник = balance>0 на конкретный месяц.
  // package: должник = balance>0 в пакете, пересекающем выбранное окно.
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackage = org?.subscriptionType === "package"

  const subWhere: any = {
    tenantId,
    deletedAt: null,
    balance: { gt: 0 }, // positive balance = debt
    ...(isPackage
      ? {
          type: "package",
          startDate: { lte: dateTo },
          OR: [{ expiresAt: null }, { expiresAt: { gte: dateFrom } }],
        }
      : {
          periodYear: year,
          periodMonth: month,
        }),
  }
  if (directionId) subWhere.directionId = directionId
  if (branchId) subWhere.group = { branchId }

  const subs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      balance: true,
      finalAmount: true,
      chargedAmount: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          funnelStatus: true,
          clientStatus: true,
          segment: true,
        },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
    orderBy: { balance: "desc" },
  })

  const data = subs.map((s) => ({
    clientId: s.client.id,
    clientName: [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
    direction: s.direction.name,
    group: s.group.name,
    funnelStatus: s.client.funnelStatus,
    segment: s.client.segment,
    isActive: s.client.clientStatus === "active",
    planDebt: Number(s.finalAmount) - Number(s.chargedAmount) + Number(s.balance),
    factDebt: Number(s.balance),
  }))

  return NextResponse.json({
    data,
    metadata: {
      totalDebtors: subs.length,
      totalPlanDebt: data.reduce((s, d) => s + d.planDebt, 0),
      totalFactDebt: data.reduce((s, d) => s + d.factDebt, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
