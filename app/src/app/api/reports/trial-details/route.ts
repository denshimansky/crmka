import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.1. Детализация пробников */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const where: any = {
    tenantId,
    scheduledDate: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) where.group = { branchId }
  if (directionId) where.group = { ...where.group, directionId }

  const trials = await db.trialLesson.findMany({
    where,
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      attendedAt: true,
      comment: true,
      client: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      ward: { select: { firstName: true, lastName: true } },
      group: {
        select: {
          name: true,
          direction: { select: { name: true } },
          branch: { select: { name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
      direction: { select: { name: true } },
    },
    orderBy: { scheduledDate: "desc" },
  })

  const data = trials.map((t) => ({
    id: t.id,
    clientId: t.client.id,
    clientName: [t.client.lastName, t.client.firstName].filter(Boolean).join(" ") || "Без имени",
    clientPhone: t.client.phone,
    wardName: t.ward
      ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ")
      : null,
    group: t.group?.name || "Индивидуально",
    direction: t.group?.direction.name || t.direction?.name || "—",
    branch: t.group?.branch.name || "—",
    instructor: t.group
      ? [t.group.instructor.lastName, t.group.instructor.firstName].filter(Boolean).join(" ")
      : "—",
    status: t.status,
    scheduledDate: t.scheduledDate.toISOString(),
    attendedAt: t.attendedAt?.toISOString() || null,
    comment: t.comment,
  }))

  const statusCounts: Record<string, number> = {}
  for (const t of trials) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
  }

  return NextResponse.json({
    data,
    metadata: {
      total: trials.length,
      statusCounts,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
