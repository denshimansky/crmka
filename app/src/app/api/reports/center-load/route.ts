import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  getReportContext,
  pct,
  countWorkingDays,
  parseHmHours,
  DEFAULT_WORKING_WEEKDAYS,
} from "@/lib/report-helpers"
import { getNonWorkingDateSet } from "@/lib/production-calendar"

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

  // Нерабочие дни производственного календаря — исключаем из максимума часов
  // (согласовано с генерацией расписания).
  const nonWorking = await getNonWorkingDateSet(tenantId, dateFrom, dateTo)

  // Calculate hours per branch
  const branchHours = new Map<string, number>()
  for (const l of filledLessons) {
    const bId = l.group.branchId
    branchHours.set(bId, (branchHours.get(bId) || 0) + l.durationMinutes / 60)
  }

  const data = branches.map((b) => {
    // Часы работы в день (минуты учитываются), рабочие дни месяца — точно по
    // календарю (а не пропорцией дней/7, иначе число дней получалось дробным).
    const start = parseHmHours(b.workingHoursStart, 9)
    const end = parseHmHours(b.workingHoursEnd, 21)
    const hoursPerDay = Math.max(0, end - start)
    const workingWeekdays =
      Array.isArray(b.workingDays) && (b.workingDays as number[]).length > 0
        ? (b.workingDays as number[])
        : DEFAULT_WORKING_WEEKDAYS
    const workingDaysInMonth = countWorkingDays(dateFrom, dateTo, workingWeekdays, nonWorking)

    const roomCount = b.rooms.length || 1
    const maxHours = hoursPerDay * workingDaysInMonth * roomCount
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
