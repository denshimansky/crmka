import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 6.3. Часы педагогов по дням */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const instructorId = searchParams.get("instructorId")

  // Lessons with at least 1 present attendance
  const lessonWhere: any = {
    tenantId,
    date: { gte: dateFrom, lte: dateTo },
    status: { not: "cancelled" },
  }
  if (instructorId) {
    lessonWhere.OR = [
      { instructorId, substituteInstructorId: null },
      { substituteInstructorId: instructorId },
    ]
  }

  const lessons = await db.lesson.findMany({
    where: lessonWhere,
    select: {
      id: true,
      date: true,
      durationMinutes: true,
      instructorId: true,
      substituteInstructorId: true,
      instructor: { select: { firstName: true, lastName: true } },
      substituteInstructor: { select: { firstName: true, lastName: true } },
      attendances: {
        where: { attendanceType: { code: "present" } },
        select: { id: true },
      },
    },
  })

  // Only lessons with at least 1 present student
  const filledLessons = lessons.filter((l) => l.attendances.length > 0)

  // Group by effective instructor (substitute when present) then by day
  const instrData = new Map<
    string,
    { name: string; byDay: Record<string, number>; totalHours: number }
  >()

  for (const l of filledLessons) {
    const iId = l.substituteInstructorId || l.instructorId
    const instr = l.substituteInstructorId && l.substituteInstructor
      ? l.substituteInstructor
      : l.instructor
    if (!instrData.has(iId)) {
      instrData.set(iId, {
        name: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
        byDay: {},
        totalHours: 0,
      })
    }
    const d = instrData.get(iId)!
    const day = l.date.toISOString().split("T")[0]
    const hours = l.durationMinutes / 60
    d.byDay[day] = (d.byDay[day] || 0) + hours
    d.totalHours += hours
  }

  const data = [...instrData.entries()]
    .map(([id, v]) => ({
      instructorId: id,
      instructorName: v.name,
      totalHours: Math.round(v.totalHours * 10) / 10,
      byDay: v.byDay,
    }))
    .sort((a, b) => b.totalHours - a.totalHours)

  return NextResponse.json({
    data,
    metadata: {
      totalHours: data.reduce((s, d) => s + d.totalHours, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
