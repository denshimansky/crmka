import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide } from "@/lib/report-helpers"

/** 6.4. Средняя ЗП педагогов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  // Lessons with attendance
  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: dateFrom, lte: dateTo },
      status: { not: "cancelled" },
    },
    select: {
      id: true,
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

  const filledLessons = lessons.filter((l) => l.attendances.length > 0)

  // Salary accrued
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
    },
    select: {
      instructorPayAmount: true,
      lesson: { select: { instructorId: true, substituteInstructorId: true } },
    },
  })

  // Aggregate (attribute to substitute instructor when present)
  const instrData = new Map<string, { name: string; hours: number; salary: number }>()

  for (const l of filledLessons) {
    const effectiveId = l.substituteInstructorId || l.instructorId
    const instr = l.substituteInstructorId && l.substituteInstructor
      ? l.substituteInstructor
      : l.instructor
    const prev = instrData.get(effectiveId) || {
      name: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
      hours: 0,
      salary: 0,
    }
    prev.hours += l.durationMinutes / 60
    instrData.set(effectiveId, prev)
  }

  for (const a of attendances) {
    const effectiveId = a.lesson.substituteInstructorId || a.lesson.instructorId
    const prev = instrData.get(effectiveId) || {
      name: "",
      hours: 0,
      salary: 0,
    }
    prev.salary += Number(a.instructorPayAmount)
    instrData.set(effectiveId, prev)
  }

  const data = [...instrData.entries()]
    .filter(([, v]) => v.hours > 0)
    .map(([id, v]) => ({
      instructorId: id,
      instructorName: v.name,
      hours: Math.round(v.hours * 10) / 10,
      salary: Math.round(v.salary),
      avgHourRate: Math.round(safeDivide(v.salary, v.hours)),
    }))
    .sort((a, b) => b.salary - a.salary)

  return NextResponse.json({
    data,
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
