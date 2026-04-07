import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 1.5. Сегментация клиентов — автоматически по количеству абонементов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  const where: any = {
    tenantId,
    deletedAt: null,
    clientStatus: "active",
  }
  if (branchId) where.branchId = branchId

  const clients = await db.client.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      segment: true,
      totalSubscriptionsCount: true,
    },
  })

  const segments: Record<string, { count: number; label: string }> = {
    new_client: { count: 0, label: "Новый (1-3 абонемента)" },
    standard: { count: 0, label: "Стандарт (4-12)" },
    regular: { count: 0, label: "Постоянный (13-18)" },
    vip: { count: 0, label: "VIP (19+)" },
  }

  for (const c of clients) {
    if (segments[c.segment]) {
      segments[c.segment].count += 1
    }
  }

  return NextResponse.json({
    data: Object.entries(segments).map(([key, v]) => ({
      segment: key,
      label: v.label,
      count: v.count,
    })),
    metadata: {
      totalClients: clients.length,
    },
  })
}
