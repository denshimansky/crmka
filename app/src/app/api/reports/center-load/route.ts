import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 4.2. Загруженность центра */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Branches with rooms
  const branchWhere: any = { tenantId, deletedAt: null }
  if (branchId) branchWhere.id = branchId

  const branches = await db.branch.findMany({
    where: branchWhere,
    select: {
      id: true,
      name: true,
      workingHoursStart: true,
      workingHoursEnd: true,
      workingDays: true,
      rooms: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
  })

  // Lessons with at least 1 student attendance in period
  const lessonWhere: any = {
    tenantId,
    date: { gte: dateFrom, lte: dateTo },
    status: { not: "cancelled" },
  }
  if (branchId) lessonWhere.group = { branchId }

  const lessons = await db.lesson.findMany({
    where: lessonWhere,
    select: {
      id: true,
      durationMinutes: true,
      group: { select: { branchId: true, roomId: true } },
      attendances: { select: { id: true } },
    },
  })

  // Only count lessons with at least 1 attendance
  const filledLessons = lessons.filter((l) => l.attendances.length > 0)

  // Calculate hours per branch
  const branchHours = new Map<string, number>()
  for (const l of filledLessons) {
    const bId = l.group.branchId
    branchHours.set(bId, (branchHours.get(bId) || 0) + l.durationMinutes / 60)
  }

  // Calculate max hours per branch based on working days/hours
  const daysBetween = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1

  const data = branches.map((b) => {
    // Working hours per day
    const start = b.workingHoursStart ? parseFloat(b.workingHoursStart.split(":")[0]) : 9
    const end = b.workingHoursEnd ? parseFloat(b.workingHoursEnd.split(":")[0]) : 21
    const hoursPerDay = end - start
    const workingDays = Array.isArray(b.workingDays) ? (b.workingDays as number[]).length : 6
    const workingDaysRatio = workingDays / 7

    const roomCount = b.rooms.length || 1
    const maxHours = hoursPerDay * daysBetween * workingDaysRatio * roomCount
    const actualHours = branchHours.get(b.id) || 0

    return {
      branchId: b.id,
      branchName: b.name,
      roomCount,
      maxHours: Math.round(maxHours * 10) / 10,
      actualHours: Math.round(actualHours * 10) / 10,
      loadPercent: pct(actualHours, maxHours),
    }
  })

  return NextResponse.json({
    data,
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
