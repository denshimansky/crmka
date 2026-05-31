import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

// Воронка продаж считается в двух плоскостях:
// - этапы «новый лид» и «активный клиент» — по Client (один родитель = один контакт);
// - этапы «заявка / пробное запланировано / пробное прошло / ожидаем оплату» —
//   по Ward.salesStage (одна сделка = один ребёнок), потому что у одного родителя
//   может быть несколько детей на разных стадиях.
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const clientWhere: any = { tenantId, deletedAt: null }
  if (branchId) clientWhere.branchId = branchId
  const wardWhere: any = { tenantId, client: { deletedAt: null, ...(branchId ? { branchId } : {}) } }

  const [allClients, allWards] = await Promise.all([
    db.client.findMany({
      where: clientWhere,
      select: { funnelStatus: true, createdAt: true, firstPaymentDate: true },
    }),
    db.ward.findMany({
      where: wardWhere,
      select: { salesStage: true, salesStageAt: true },
    }),
  ])

  const totalClients = allClients.length

  // === Block 1: воронка периода ===
  // «new» — по родителям, созданным в периоде, в стадии «новый».
  // «active_client» — по родителям, у которых первая оплата попала в период.
  // Все «сделочные» стадии (application/trial_*) — по Ward.salesStageAt в периоде.
  const periodNew = allClients.filter(
    (c) => c.funnelStatus === "new" && c.createdAt >= dateFrom && c.createdAt <= dateTo
  ).length

  const periodWardsByStage: Record<string, number> = {}
  for (const w of allWards) {
    if (w.salesStageAt && w.salesStageAt >= dateFrom && w.salesStageAt <= dateTo) {
      periodWardsByStage[w.salesStage] = (periodWardsByStage[w.salesStage] || 0) + 1
    }
  }

  const convertedThisPeriod = allClients.filter(
    (c) =>
      c.firstPaymentDate &&
      c.firstPaymentDate >= dateFrom &&
      c.firstPaymentDate <= dateTo
  ).length

  const funnelData = [
    { status: "new", count: periodNew },
    { status: "application", count: periodWardsByStage["application"] || 0 },
    { status: "trial_scheduled", count: periodWardsByStage["trial_scheduled"] || 0 },
    { status: "trial_attended", count: periodWardsByStage["trial_attended"] || 0 },
    { status: "awaiting_payment", count: periodWardsByStage["awaiting_payment"] || 0 },
    { status: "active_client", count: convertedThisPeriod },
  ]

  // === Block 2: перетекающие из прошлых периодов ===
  // По родителям: «new» и «potential» (созданы раньше, ещё в работе).
  // По Ward: сделки, которые поднялись в воронку до периода и ещё в ней висят.
  const carryoverCounts: Record<string, number> = {}
  for (const c of allClients) {
    if (c.createdAt < dateFrom && (c.funnelStatus === "new" || c.funnelStatus === "potential")) {
      carryoverCounts[c.funnelStatus] = (carryoverCounts[c.funnelStatus] || 0) + 1
    }
  }
  for (const w of allWards) {
    if (
      w.salesStage !== "none" &&
      (!w.salesStageAt || w.salesStageAt < dateFrom)
    ) {
      carryoverCounts[w.salesStage] = (carryoverCounts[w.salesStage] || 0) + 1
    }
  }

  // Metrics
  const newThisPeriod = allClients.filter(
    (c) => c.createdAt >= dateFrom && c.createdAt <= dateTo
  ).length

  return NextResponse.json({
    data: {
      funnel: funnelData,
      carryover: carryoverCounts,
    },
    metadata: {
      totalClients,
      newThisPeriod,
      convertedThisPeriod,
      // Конверсия лид → платящий клиент: по родителям (один контакт = одна продажа).
      conversionRate: pct(
        allClients.filter((c) => c.funnelStatus === "active_client").length,
        totalClients
      ),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
