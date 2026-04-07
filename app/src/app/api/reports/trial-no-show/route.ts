import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.2. Не пришли на пробники */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const where: any = {
    tenantId,
    scheduledDate: { gte: dateFrom, lte: dateTo },
    status: { in: ["no_show", "cancelled"] },
  }
  if (branchId) where.group = { branchId }

  const trials = await db.trialLesson.findMany({
    where,
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      comment: true,
      client: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      group: {
        select: {
          name: true,
          direction: { select: { name: true } },
          branch: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledDate: "desc" },
  })

  const data = trials.map((t) => ({
    id: t.id,
    clientId: t.client.id,
    clientName: [t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Без имени",
    clientPhone: t.client.phone,
    group: t.group.name,
    direction: t.group.direction.name,
    branch: t.group.branch.name,
    status: t.status,
    scheduledDate: t.scheduledDate.toISOString(),
    comment: t.comment,
  }))

  return NextResponse.json({
    data,
    metadata: {
      total: trials.length,
      noShow: trials.filter((t) => t.status === "no_show").length,
      cancelled: trials.filter((t) => t.status === "cancelled").length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
