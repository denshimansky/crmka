import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** ATT-09. Неотмеченные дети — занятия с пропущенной отметкой посещений */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  const now = new Date()

  // Lessons in the past within the date range
  const lessonWhere: any = {
    tenantId,
    date: { gte: dateFrom, lte: dateTo < now ? dateTo : now },
    status: { not: "cancelled" },
  }
  if (branchId) {
    lessonWhere.group = { branchId }
  }

  const lessons = await db.lesson.findMany({
    where: lessonWhere,
    select: {
      id: true,
      date: true,
      startTime: true,
      group: {
        select: {
          id: true,
          name: true,
          branchId: true,
          branch: { select: { name: true } },
          direction: { select: { name: true } },
        },
      },
      instructor: { select: { id: true, firstName: true, lastName: true } },
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
      attendances: {
        select: {
          clientId: true,
          wardId: true,
        },
      },
    },
    orderBy: [{ date: "desc" }, { startTime: "asc" }],
  })

  // Get all active enrollments for these groups
  const groupIds = [...new Set(lessons.map((l) => l.group.id))]
  if (groupIds.length === 0) {
    return NextResponse.json({
      data: { rows: [] },
      metadata: { totalLessons: 0, totalUnmarked: 0, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    })
  }

  const enrollments = await db.groupEnrollment.findMany({
    where: {
      tenantId,
      groupId: { in: groupIds },
      isActive: true,
      deletedAt: null,
    },
    select: {
      groupId: true,
      clientId: true,
      wardId: true,
      enrolledAt: true,
      selectedDays: true,
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // Index enrollments by groupId
  const enrollmentsByGroup = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const list = enrollmentsByGroup.get(e.groupId) || []
    list.push(e)
    enrollmentsByGroup.set(e.groupId, list)
  }

  interface UnmarkedRow {
    lessonId: string
    lessonDate: string
    startTime: string
    groupName: string
    branchName: string
    directionName: string
    instructorName: string
    unmarkedStudents: {
      clientId: string
      clientName: string
      wardId: string | null
      wardName: string | null
      phone: string | null
    }[]
  }

  const rows: UnmarkedRow[] = []

  for (const lesson of lessons) {
    const lessonDate = new Date(lesson.date)
    const dayOfWeek = lessonDate.getUTCDay() === 0 ? 7 : lessonDate.getUTCDay()

    const groupEnrollments = enrollmentsByGroup.get(lesson.group.id) || []

    // Filter enrollments relevant to this lesson:
    // - enrolled before or on the lesson date
    // - if selectedDays is set, lesson day must match
    const relevantEnrollments = groupEnrollments.filter((e) => {
      if (new Date(e.enrolledAt) > lessonDate) return false
      if (e.selectedDays && Array.isArray(e.selectedDays)) {
        return (e.selectedDays as number[]).includes(dayOfWeek)
      }
      return true
    })

    // Find which enrolled students have no attendance record for this lesson
    const markedSet = new Set(
      lesson.attendances.map((a) => `${a.clientId}|${a.wardId || ""}`)
    )

    const unmarked = relevantEnrollments.filter(
      (e) => !markedSet.has(`${e.clientId}|${e.wardId || ""}`)
    )

    if (unmarked.length > 0) {
      const instr = lesson.substituteInstructor || lesson.instructor
      rows.push({
        lessonId: lesson.id,
        lessonDate: lessonDate.toISOString().slice(0, 10),
        startTime: lesson.startTime,
        groupName: lesson.group.name,
        branchName: lesson.group.branch.name,
        directionName: lesson.group.direction.name,
        instructorName: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
        unmarkedStudents: unmarked.map((e) => ({
          clientId: e.clientId,
          clientName: [e.client.lastName, e.client.firstName].filter(Boolean).join(" "),
          wardId: e.wardId,
          wardName: e.ward ? [e.ward.lastName, e.ward.firstName].filter(Boolean).join(" ") : null,
          phone: e.client.phone,
        })),
      })
    }
  }

  const totalUnmarked = rows.reduce((sum, r) => sum + r.unmarkedStudents.length, 0)

  return NextResponse.json({
    data: { rows },
    metadata: {
      totalLessons: rows.length,
      totalUnmarked,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
