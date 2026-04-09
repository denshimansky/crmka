import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/**
 * ATT-10: Потенциальный отток — ученики с N+ прогулами за месяц.
 *
 * GET ?month=2026-04&branchId=...&threshold=3
 */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session

  const monthParam = searchParams.get("month") // YYYY-MM
  const branchId = searchParams.get("branchId")
  const threshold = Math.max(1, parseInt(searchParams.get("threshold") || "3", 10))

  // Parse month range
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth() // 0-based
  if (monthParam) {
    const parts = monthParam.split("-")
    year = parseInt(parts[0], 10)
    month = parseInt(parts[1], 10) - 1
  }
  const dateFrom = new Date(Date.UTC(year, month, 1))
  const dateTo = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))

  // Find active enrollments
  const enrollmentWhere: any = {
    tenantId,
    isActive: true,
    deletedAt: null,
  }
  if (branchId) {
    enrollmentWhere.group = { branchId }
  }

  const enrollments = await db.groupEnrollment.findMany({
    where: enrollmentWhere,
    select: {
      id: true,
      clientId: true,
      wardId: true,
      group: {
        select: {
          id: true,
          name: true,
          direction: { select: { name: true } },
          branch: { select: { id: true, name: true } },
        },
      },
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      ward: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  if (enrollments.length === 0) {
    return NextResponse.json({ data: [], metadata: { threshold, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
  }

  // Get all absences (attendance types that don't charge and don't pay instructor = прогул)
  const absenceTypes = await db.attendanceType.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      chargesSubscription: false,
      paysInstructor: false,
    },
    select: { id: true },
  })
  const absenceTypeIds = absenceTypes.map((t) => t.id)

  if (absenceTypeIds.length === 0) {
    return NextResponse.json({ data: [], metadata: { threshold, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
  }

  // Get attendance records for the period that are absences
  const absences = await db.attendance.findMany({
    where: {
      tenantId,
      attendanceTypeId: { in: absenceTypeIds },
      lesson: {
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    select: {
      clientId: true,
      wardId: true,
      lesson: {
        select: {
          date: true,
          groupId: true,
        },
      },
    },
    orderBy: { lesson: { date: "desc" } },
  })

  // Group absences by clientId+wardId+groupId
  const absenceMap = new Map<string, { count: number; lastDate: Date }>()
  for (const a of absences) {
    const key = `${a.clientId}|${a.wardId || ""}|${a.lesson.groupId}`
    const existing = absenceMap.get(key)
    if (existing) {
      existing.count++
      if (a.lesson.date > existing.lastDate) existing.lastDate = a.lesson.date
    } else {
      absenceMap.set(key, { count: 1, lastDate: a.lesson.date })
    }
  }

  // Build result — match enrollments with absences >= threshold
  const data: Array<{
    clientId: string
    clientName: string
    wardName: string | null
    groupName: string
    directionName: string
    branchName: string
    absenceCount: number
    lastAbsenceDate: string
  }> = []

  for (const enrollment of enrollments) {
    const key = `${enrollment.clientId}|${enrollment.wardId || ""}|${enrollment.group.id}`
    const info = absenceMap.get(key)
    if (info && info.count >= threshold) {
      const clientName = [enrollment.client.lastName, enrollment.client.firstName].filter(Boolean).join(" ") || "Без имени"
      const wardName = enrollment.ward
        ? [enrollment.ward.lastName, enrollment.ward.firstName].filter(Boolean).join(" ") || null
        : null

      data.push({
        clientId: enrollment.clientId,
        clientName,
        wardName,
        groupName: enrollment.group.name,
        directionName: enrollment.group.direction.name,
        branchName: enrollment.group.branch.name,
        absenceCount: info.count,
        lastAbsenceDate: info.lastDate.toISOString(),
      })
    }
  }

  // Sort by absence count DESC
  data.sort((a, b) => b.absenceCount - a.absenceCount)

  return NextResponse.json({
    data,
    metadata: {
      threshold,
      total: data.length,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
