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

  // Только реальные неявки (no_show). cancelled — технический статус
  // (перенос даты на «Продажах», удаление заявки), а не «клиент не пришёл»;
  // каждая неявка — отдельная запись TrialLesson, считаем все.
  const where: any = {
    tenantId,
    scheduledDate: { gte: dateFrom, lte: dateTo },
    status: "no_show",
    client: { deletedAt: null },
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
      ward: {
        select: { firstName: true, lastName: true },
      },
      group: {
        select: {
          name: true,
          direction: { select: { name: true } },
          branch: { select: { name: true } },
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
    childName: t.ward ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ") || "—" : "—",
    clientPhone: t.client.phone,
    group: t.group?.name || "Индивидуально",
    direction: t.group?.direction.name || t.direction?.name || "—",
    branch: t.group?.branch.name || "—",
    status: t.status,
    scheduledDate: t.scheduledDate.toISOString(),
    comment: t.comment,
  }))

  return NextResponse.json({
    data,
    metadata: {
      total: trials.length,
      noShow: trials.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
