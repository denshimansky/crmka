import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"
import {
  SEGMENT_ORDER,
  computeSegment,
  effectiveSegment,
  monthsSince,
  parseSegmentationConfig,
  segmentRangeLabel,
  type ClientSegmentKey,
} from "@/lib/segmentation"

/**
 * 1.5. Сегментация клиентов (баг #26).
 * Следует настройкам организации (Organization.segmentationConfig):
 *   mode="amount" — по Σ отработанной выручки (Subscription.chargedAmount);
 *   mode="months" — по числу месяцев с первой оплаты.
 * Эффективный сегмент = ручное переопределение (Client.segmentOverride) ?? авто.
 * Если настройки не заданы — у всех «Новый» (кроме заданных вручную).
 */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { segmentationConfig: true },
  })
  const config = parseSegmentationConfig(org?.segmentationConfig)

  const where: { tenantId: string; deletedAt: null; clientStatus: "active"; branchId?: string } = {
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
      segmentOverride: true,
      firstPaymentDate: true,
      branch: { select: { name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  })

  // Метрика для mode="amount" — Σ Subscription.chargedAmount по клиенту, одним
  // groupBy. Для mode="months" хватает firstPaymentDate из самого Client.
  const chargedByClient = new Map<string, number>()
  if (config?.mode === "amount" && clients.length > 0) {
    const sums = await db.subscription.groupBy({
      by: ["clientId"],
      where: { tenantId, clientId: { in: clients.map((c) => c.id) }, deletedAt: null },
      _sum: { chargedAmount: true },
    })
    for (const s of sums) {
      chargedByClient.set(s.clientId, Number(s._sum.chargedAmount ?? 0))
    }
  }

  const buckets: Record<
    ClientSegmentKey,
    { count: number; clients: Array<{ id: string; name: string; metric: number; branchName: string | null; manual: boolean }> }
  > = {
    new_client: { count: 0, clients: [] },
    standard: { count: 0, clients: [] },
    regular: { count: 0, clients: [] },
    vip: { count: 0, clients: [] },
  }

  for (const c of clients) {
    const metric = config
      ? config.mode === "amount"
        ? chargedByClient.get(c.id) ?? 0
        : monthsSince(c.firstPaymentDate)
      : 0
    const computed: ClientSegmentKey = config ? computeSegment(metric, config) : "new_client"
    const override = (c.segmentOverride ?? null) as ClientSegmentKey | null
    const seg = effectiveSegment(override, computed)
    buckets[seg].count += 1
    buckets[seg].clients.push({
      id: c.id,
      name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
      metric: Math.round(metric),
      branchName: c.branch?.name ?? null,
      manual: override !== null,
    })
  }

  return NextResponse.json({
    data: SEGMENT_ORDER.map((key) => ({
      segment: key,
      label: segmentRangeLabel(key, config),
      count: buckets[key].count,
      clients: buckets[key].clients,
    })),
    metadata: {
      totalClients: clients.length,
      mode: config?.mode ?? null,
      configured: !!config,
    },
  })
}
