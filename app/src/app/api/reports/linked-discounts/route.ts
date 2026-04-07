import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.11. Связанные скидки */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  const discounts = await db.discount.findMany({
    where: {
      tenantId,
      type: "linked",
      isActive: true,
    },
    select: {
      id: true,
      value: true,
      valueType: true,
      calculatedAmount: true,
      linkedClientId: true,
      startDate: true,
      comment: true,
      subscription: {
        select: {
          client: { select: { id: true, firstName: true, lastName: true, clientStatus: true } },
          direction: { select: { name: true } },
        },
      },
    },
  })

  // Fetch linked clients
  const linkedClientIds = discounts.filter((d) => d.linkedClientId).map((d) => d.linkedClientId!)
  const linkedClients =
    linkedClientIds.length > 0
      ? await db.client.findMany({
          where: { id: { in: linkedClientIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, clientStatus: true },
        })
      : []
  const linkedMap = new Map(linkedClients.map((c) => [c.id, c]))

  const data = discounts.map((d) => {
    const linked = d.linkedClientId ? linkedMap.get(d.linkedClientId) : null
    return {
      discountId: d.id,
      recipientClientId: d.subscription.client.id,
      recipientName: [d.subscription.client.lastName, d.subscription.client.firstName].filter(Boolean).join(" ") || "Без имени",
      recipientStatus: d.subscription.client.clientStatus,
      direction: d.subscription.direction.name,
      linkedClientId: d.linkedClientId,
      linkedClientName: linked
        ? [linked.lastName, linked.firstName].filter(Boolean).join(" ")
        : null,
      linkedClientStatus: linked?.clientStatus || null,
      discountValue: Number(d.value),
      valueType: d.valueType,
      calculatedAmount: Number(d.calculatedAmount),
      startDate: d.startDate.toISOString(),
      comment: d.comment,
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalLinkedDiscounts: discounts.length,
      totalAmount: data.reduce((s, d) => s + d.calculatedAmount, 0),
    },
  })
}
