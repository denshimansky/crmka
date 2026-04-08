import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.12. Контроль корректировок занятий (аудит) */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  // Audit logs for Attendance entity updates
  const logs = await db.auditLog.findMany({
    where: {
      tenantId,
      entityType: "Attendance",
      action: "update",
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    select: {
      id: true,
      entityId: true,
      changes: true,
      createdAt: true,
      employeeId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  // Filter only those with charge_amount changes
  const filtered = logs.filter((l) => {
    const details = l.changes as any
    return details && (details.chargeAmount || details.charge_amount)
  })

  // Get employee names
  const empIds = [...new Set(filtered.map((l) => l.employeeId))]
  const employees = empIds.length > 0
    ? await db.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const empMap = new Map(employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ")]))

  // Get attendance details for entity IDs
  const attIds = filtered.map((l) => l.entityId).filter((id): id is string => id !== null)
  const attendances = attIds.length > 0
    ? await db.attendance.findMany({
        where: { id: { in: attIds } },
        select: {
          id: true,
          clientId: true,
          client: { select: { firstName: true, lastName: true } },
          subscription: { select: { direction: { select: { name: true } } } },
          lesson: { select: { date: true } },
        },
      })
    : []
  const attMap = new Map(attendances.map((a) => [a.id, a]))

  const data = filtered.map((l) => {
    const details = l.changes as any
    const chargeChange = details?.chargeAmount || details?.charge_amount || {}
    const att = l.entityId ? attMap.get(l.entityId) : undefined

    return {
      auditId: l.id,
      date: l.createdAt.toISOString(),
      changedBy: empMap.get(l.employeeId) || "Неизвестный",
      clientName: att
        ? [att.client.lastName, att.client.firstName].filter(Boolean).join(" ")
        : "Неизвестный",
      direction: att?.subscription?.direction?.name || null,
      lessonDate: att?.lesson?.date?.toISOString() || null,
      oldAmount: chargeChange.old !== undefined ? Number(chargeChange.old) : null,
      newAmount: chargeChange.new !== undefined ? Number(chargeChange.new) : null,
      difference:
        chargeChange.old !== undefined && chargeChange.new !== undefined
          ? Number(chargeChange.new) - Number(chargeChange.old)
          : null,
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      totalAdjustments: filtered.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
