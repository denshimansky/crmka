import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 6.2. Прогноз сдельной оплаты */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Salary rates for instructors
  const rates = await db.salaryRate.findMany({
    where: { tenantId },
    select: {
      id: true,
      employeeId: true,
      directionId: true,
      scheme: true,
      ratePerStudent: true,
      ratePerLesson: true,
      fixedPerShift: true,
      employee: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
    },
  })

  // Get lesson/attendance counts per instructor per direction
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
    },
    select: {
      lesson: {
        select: {
          id: true,
          instructorId: true,
          substituteInstructorId: true,
          group: {
            select: {
              directionId: true,
              direction: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  // Count students per instructor+direction (attribute to substitute when present)
  const instrDirKey = (instrId: string, dirId: string) => `${instrId}:${dirId}`
  const studentCounts = new Map<string, number>()
  const lessonSets = new Map<string, Set<string>>()

  for (const a of attendances) {
    const effectiveId = a.lesson.substituteInstructorId || a.lesson.instructorId
    const key = instrDirKey(effectiveId, a.lesson.group.directionId)
    studentCounts.set(key, (studentCounts.get(key) || 0) + 1)
    if (!lessonSets.has(key)) lessonSets.set(key, new Set())
    lessonSets.get(key)!.add(a.lesson.id)
  }

  // Already paid
  const payments = await db.salaryPayment.findMany({
    where: { tenantId, periodYear: year, periodMonth: month },
    select: { employeeId: true, amount: true },
  })
  const paidMap = new Map<string, number>()
  for (const p of payments) {
    paidMap.set(p.employeeId, (paidMap.get(p.employeeId) || 0) + Number(p.amount))
  }

  const data = rates.map((r) => {
    const key = instrDirKey(r.employeeId, r.directionId || "")
    const students = studentCounts.get(key) || 0
    const lessons = lessonSets.get(key)?.size || 0

    let forecast = 0
    if (r.scheme === "per_student") {
      forecast = students * Number(r.ratePerStudent || 0)
    } else if (r.scheme === "per_lesson") {
      forecast = lessons * Number(r.ratePerLesson || 0)
    } else if (r.scheme === "fixed_plus_per_student") {
      forecast = lessons * Number(r.fixedPerShift || 0) + students * Number(r.ratePerStudent || 0)
    }

    const paid = paidMap.get(r.employeeId) || 0

    return {
      instructorId: r.employeeId,
      instructorName: [r.employee.lastName, r.employee.firstName].filter(Boolean).join(" "),
      direction: r.direction?.name || "Все",
      scheme: r.scheme,
      ratePerStudent: Number(r.ratePerStudent || 0),
      ratePerLesson: Number(r.ratePerLesson || 0),
      fixedPerShift: Number(r.fixedPerShift || 0),
      studentsCount: students,
      lessonsCount: lessons,
      forecast,
      paid,
      remaining: Math.max(0, forecast - paid),
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => b.forecast - a.forecast),
    metadata: {
      totalForecast: data.reduce((s, d) => s + d.forecast, 0),
      totalPaid: data.reduce((s, d) => s + d.paid, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
