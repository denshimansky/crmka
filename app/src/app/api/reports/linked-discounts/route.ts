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
          template: { select: { name: true } },
        },
      },
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  })

  const sourceLabel: Record<string, string> = {
    type1: "За второй абонемент (авто)",
    type2: "Постоянная",
    legacy: "Старая логика",
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
      sourceLabel: sourceLabel[s.discountSource] ?? s.discountSource,
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
