import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/**
 * 5.11. Действующие скидки (бывш. «Связанные скидки»).
 *
 * Скидки v2: концепция пар «основание/связанный» упразднена. Отчёт — список
 * абонементов с действующей скидкой, по типам:
 *   type1  — автоскидка «за второй абонемент»;
 *   type2  — постоянная скидка (ручной выбор в карточке);
 *   legacy — замороженные скидки старой логики (доживают на абонементах).
 */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session } = result.ctx
  const { tenantId } = session

  const subs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      discountSource: { not: "none" },
    },
    select: {
      id: true,
      discountSource: true,
      discountPerLesson: true,
      discountAmount: true,
      totalAmount: true,
      finalAmount: true,
      periodYear: true,
      periodMonth: true,
      type: true,
      client: { select: { id: true, firstName: true, lastName: true, clientStatus: true } },
      ward: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
      group: { select: { name: true, branch: { select: { id: true, name: true } } } },
      discounts: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          valueType: true,
          value: true,
          calculatedAmount: true,
          startDate: true,
          // Скидки v3: scope шаблона — чтобы различать клиентский тип-2 и
          // пер-абонементный («На абонемент») в подписи источника.
          template: { select: { name: true, scope: true } },
        },
      },
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  })

  // Скидки v3: тип-2 может быть клиентским («Постоянная») или пер-абонементным
  // («На абонемент», scope=subscription) — различаем в подписи источника.
  const sourceLabelFor = (source: string, scope: string | null | undefined): string => {
    if (source === "type1") return "За второй абонемент (авто)"
    if (source === "type2") return scope === "subscription" ? "На абонемент" : "Постоянная"
    if (source === "legacy") return "Старая логика"
    return source
  }

  const data = subs.map((s) => {
    const d = s.discounts[0] ?? null
    return {
      subscriptionId: s.id,
      clientId: s.client.id,
      clientName:
        [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени",
      clientStatus: s.client.clientStatus,
      wardName: s.ward
        ? [s.ward.lastName, s.ward.firstName].filter(Boolean).join(" ")
        : null,
      direction: s.direction.name,
      group: s.group.name,
      branch: s.group.branch?.name ?? null,
      period:
        s.periodYear && s.periodMonth
          ? `${String(s.periodMonth).padStart(2, "0")}.${s.periodYear}`
          : s.type === "package"
            ? "Пакет"
            : null,
      source: s.discountSource,
      sourceLabel: sourceLabelFor(s.discountSource, d?.template?.scope),
      templateName: d?.template?.name ?? null,
      discountPerLesson: Number(s.discountPerLesson),
      discountAmount: Number(s.discountAmount),
      totalAmount: Number(s.totalAmount),
      finalAmount: Number(s.finalAmount),
      startDate: d?.startDate ? d.startDate.toISOString() : null,
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalDiscountedSubscriptions: data.length,
      totalAmount: data.reduce((s, d) => s + d.discountAmount, 0),
      byType: {
        type1: data.filter((d) => d.source === "type1").length,
        type2: data.filter((d) => d.source === "type2").length,
        legacy: data.filter((d) => d.source === "legacy").length,
      },
    },
  })
}
