import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.13. Контроль скидок (аудит) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const discounts = await db.discount.findMany({
    where: {
      tenantId,
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    select: {
      id: true,
      type: true,
      value: true,
      valueType: true,
      calculatedAmount: true,
      comment: true,
      createdBy: true,
      createdAt: true,
      subscription: {
        select: {
          client: { select: { id: true, firstName: true, lastName: true, branchId: true } },
          direction: { select: { name: true } },
          group: { select: { branch: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // Filter by branch
  const filtered = branchId
    ? discounts.filter((d) => d.subscription.client.branchId === branchId)
    : discounts

  // Get creator names
  const creatorIds = [...new Set(filtered.filter((d) => d.createdBy).map((d) => d.createdBy!))]
  const creators =
    creatorIds.length > 0
      ? await db.employee.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
  const creatorMap = new Map(creators.map((c) => [c.id, [c.lastName, c.firstName].filter(Boolean).join(" ")]))

  const data = filtered.map((d) => ({
    discountId: d.id,
    createdAt: d.createdAt.toISOString(),
    createdBy: d.createdBy ? creatorMap.get(d.createdBy) || "Неизвестный" : null,
    clientId: d.subscription.client.id,
    clientName: [d.subscription.client.lastName, d.subscription.client.firstName].filter(Boolean).join(" ") || "Без имени",
    direction: d.subscription.direction.name,
    branch: d.subscription.group.branch.name,
    type: d.type,
    value: Number(d.value),
    valueType: d.valueType,
    calculatedAmount: Number(d.calculatedAmount),
    comment: d.comment,
  }))

  return NextResponse.json({
    data,
    metadata: {
      totalDiscounts: filtered.length,
      totalAmount: data.reduce((s, d) => s + d.calculatedAmount, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
