import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 3.10. Эффективность обзвонов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const campaignId = searchParams.get("campaignId")

  const campWhere: any = {
    tenantId,
    deletedAt: null,
    createdAt: { gte: dateFrom, lte: dateTo },
  }
  if (campaignId) campWhere.id = campaignId

  const campaigns = await db.callCampaign.findMany({
    where: campWhere,
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      totalItems: true,
      completedItems: true,
      items: {
        select: {
          status: true,
          result: true,
        },
      },
    },
  })

  const data = campaigns.map((c) => {
    const total = c.items.length
    const processed = c.items.filter((i) => i.status !== "pending").length
    const trialScheduled = c.items.filter((i) => i.result === "trial_scheduled").length
    const sales = c.items.filter((i) => i.result === "sale").length
    const noAnswer = c.items.filter((i) => i.result === "no_answer").length
    const refused = c.items.filter((i) => i.result === "refused").length

    return {
      campaignId: c.id,
      campaignName: c.name,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      total,
      processed,
      trialScheduled,
      sales,
      noAnswer,
      refused,
      processedRate: pct(processed, total),
      trialConversion: pct(trialScheduled, processed),
      saleConversion: pct(sales, processed),
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalCampaigns: campaigns.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
