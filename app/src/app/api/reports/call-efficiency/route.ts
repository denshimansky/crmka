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
      items: {
        select: {
          status: true,
          // Заявки, созданные из этой позиции обзвона (кнопка «Создать заявку»).
          // Через них тянем всю воронку: пробное и продажа заявки атрибутируются
          // к обзвону, из которого она выросла.
          applications: {
            where: { deletedAt: null },
            select: {
              processedToStatus: true,
              // Пробное = хотя бы одно неотменённое пробное занятие по заявке.
              trialLessons: {
                where: { status: { not: "cancelled" } },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  })

  const data = campaigns.map((c) => {
    const total = c.items.length
    const processed = c.items.filter((i) => i.status !== "pending").length
    // Заявки, выросшие из обзвона, и их дальнейшая судьба в воронке продаж.
    const apps = c.items.flatMap((i) => i.applications)
    const applications = apps.length
    const trialScheduled = apps.filter((a) => a.trialLessons.length > 0).length
    // Продажа = заявка закрыта как «Купил» (по ней оплачен абонемент).
    const sales = apps.filter((a) => a.processedToStatus === "won").length

    return {
      campaignId: c.id,
      campaignName: c.name,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      total,
      processed,
      applications,
      trialScheduled,
      sales,
      processedRate: pct(processed, total),
      applicationConversion: pct(applications, processed),
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
