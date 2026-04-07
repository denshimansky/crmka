import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.11. Продажи менеджеров по каналам */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const mode = searchParams.get("mode") || "sales" // trials_scheduled | trials_attended | sales

  // Get employees
  const employees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, role: { in: ["admin", "manager", "owner"] } },
    select: { id: true, firstName: true, lastName: true },
  })
  const empMap = new Map(employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ")]))

  if (mode === "trials_scheduled" || mode === "trials_attended") {
    const trialWhere: any = { tenantId }
    if (mode === "trials_scheduled") {
      trialWhere.createdAt = { gte: dateFrom, lte: dateTo }
    } else {
      trialWhere.scheduledDate = { gte: dateFrom, lte: dateTo }
      trialWhere.status = "attended"
    }

    const trials = await db.trialLesson.findMany({
      where: trialWhere,
      select: {
        createdBy: true,
        client: { select: { channelId: true } },
      },
    })

    const grid: Record<string, Record<string, number>> = {}
    for (const t of trials) {
      const emp = t.createdBy || "unknown"
      const ch = t.client.channelId || "unknown"
      if (!grid[emp]) grid[emp] = {}
      grid[emp][ch] = (grid[emp][ch] || 0) + 1
    }

    const data = Object.entries(grid).map(([empId, channels]) => ({
      managerId: empId,
      managerName: empMap.get(empId) || "Неизвестный",
      total: Object.values(channels).reduce((s, v) => s + v, 0),
      byChannel: channels,
    }))

    return NextResponse.json({ data, metadata: { mode, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
  }

  // Sales mode — subscriptions with saleDate in period
  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      saleDate: { gte: dateFrom, lte: dateTo },
    },
    select: { createdBy: true, channelId: true },
  })

  const grid: Record<string, Record<string, number>> = {}
  for (const c of clients) {
    const emp = c.createdBy || "unknown"
    const ch = c.channelId || "unknown"
    if (!grid[emp]) grid[emp] = {}
    grid[emp][ch] = (grid[emp][ch] || 0) + 1
  }

  const data = Object.entries(grid).map(([empId, channels]) => ({
    managerId: empId,
    managerName: empMap.get(empId) || "Неизвестный",
    total: Object.values(channels).reduce((s, v) => s + v, 0),
    byChannel: channels,
  }))

  return NextResponse.json({ data, metadata: { mode, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
}
