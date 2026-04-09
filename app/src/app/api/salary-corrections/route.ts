import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/salary-corrections?year=2026&month=4
 *
 * Returns attendance corrections made after period close for closed periods
 * that affect salary calculations. Groups by instructor, showing:
 * - original period (year/month)
 * - original vs corrected instructor pay
 * - net difference
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const { searchParams } = new URL(req.url)
  const year = Number(searchParams.get("year")) || new Date().getFullYear()
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1

  // Find closed periods for this tenant (excluding the requested period itself)
  const closedPeriods = await db.period.findMany({
    where: {
      tenantId,
      status: { in: ["closed", "reopened"] },
    },
    select: { year: true, month: true, closedAt: true, status: true },
  })

  if (closedPeriods.length === 0) {
    return NextResponse.json({ corrections: [], totals: { totalDifference: 0 } })
  }

  // For each closed period, find attendances marked as isAfterPeriodClose
  // These are corrections made after the period was closed
  const allCorrections: Array<{
    periodYear: number
    periodMonth: number
    instructorId: string
    instructorName: string
    originalAmount: number
    correctedAmount: number
    difference: number
    correctionCount: number
  }> = []

  for (const period of closedPeriods) {
    const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1))
    const periodEnd = new Date(Date.UTC(period.year, period.month, 0))

    // Get attendances that were modified after period close
    const correctedAttendances = await db.attendance.findMany({
      where: {
        tenantId,
        isAfterPeriodClose: true,
        lesson: {
          date: { gte: periodStart, lte: periodEnd },
        },
      },
      select: {
        id: true,
        instructorPayAmount: true,
        instructorPayEnabled: true,
        lesson: {
          select: {
            instructorId: true,
            instructor: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    })

    if (correctedAttendances.length === 0) continue

    // Get audit logs for these attendances to find original values
    const attendanceIds = correctedAttendances.map((a) => a.id)
    const auditLogs = await db.auditLog.findMany({
      where: {
        tenantId,
        entityType: "Attendance",
        entityId: { in: attendanceIds },
        isAfterPeriodClose: true,
      },
      select: {
        entityId: true,
        changes: true,
        action: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    // Build a map of original pay amounts from audit logs
    const originalPayMap = new Map<string, number>()
    for (const log of auditLogs) {
      const changes = log.changes as Record<string, { old?: any; new?: any }> | null
      if (!changes) continue

      // Check for instructorPayAmount changes
      if (changes.instructorPayAmount) {
        const oldVal = Number(changes.instructorPayAmount.old ?? 0)
        // Store the earliest old value (the original before any correction)
        if (!originalPayMap.has(log.entityId)) {
          originalPayMap.set(log.entityId, oldVal)
        }
      }

      // Check for instructorPayEnabled changes
      if (changes.instructorPayEnabled) {
        const wasEnabled = changes.instructorPayEnabled.old
        if (wasEnabled === true && !originalPayMap.has(log.entityId)) {
          // Was enabled, now disabled — original amount is the current instructorPayAmount
          const attendance = correctedAttendances.find((a) => a.id === log.entityId)
          if (attendance) {
            originalPayMap.set(log.entityId, Number(attendance.instructorPayAmount))
          }
        }
      }
    }

    // Aggregate by instructor
    const instrAgg = new Map<
      string,
      { name: string; original: number; corrected: number; count: number }
    >()

    for (const att of correctedAttendances) {
      const instrId = att.lesson.instructorId
      const instrName = [att.lesson.instructor.lastName, att.lesson.instructor.firstName]
        .filter(Boolean)
        .join(" ")

      if (!instrAgg.has(instrId)) {
        instrAgg.set(instrId, { name: instrName, original: 0, corrected: 0, count: 0 })
      }

      const agg = instrAgg.get(instrId)!
      const currentPay = att.instructorPayEnabled ? Number(att.instructorPayAmount) : 0
      const originalPay = originalPayMap.get(att.id) ?? currentPay

      agg.original += originalPay
      agg.corrected += currentPay
      agg.count += 1
    }

    for (const [instrId, agg] of instrAgg) {
      const diff = agg.corrected - agg.original
      if (diff === 0) continue // No net effect — skip

      allCorrections.push({
        periodYear: period.year,
        periodMonth: period.month,
        instructorId: instrId,
        instructorName: agg.name,
        originalAmount: agg.original,
        correctedAmount: agg.corrected,
        difference: diff,
        correctionCount: agg.count,
      })
    }
  }

  // Also check salary adjustments created after period close
  // (adjustments for already-closed periods)
  for (const period of closedPeriods) {
    if (!period.closedAt) continue

    const lateAdjustments = await db.salaryAdjustment.findMany({
      where: {
        tenantId,
        periodYear: period.year,
        periodMonth: period.month,
        createdAt: { gt: period.closedAt },
      },
      select: {
        employeeId: true,
        type: true,
        amount: true,
        comment: true,
        employee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    })

    for (const adj of lateAdjustments) {
      const name = [adj.employee.lastName, adj.employee.firstName].filter(Boolean).join(" ")
      const amt = Number(adj.amount)
      const diff = adj.type === "bonus" ? amt : -amt

      allCorrections.push({
        periodYear: period.year,
        periodMonth: period.month,
        instructorId: adj.employeeId,
        instructorName: name,
        originalAmount: 0,
        correctedAmount: amt,
        difference: diff,
        correctionCount: 1,
      })
    }
  }

  // Sort by period desc, then instructor name
  allCorrections.sort((a, b) => {
    const periodDiff = (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth)
    if (periodDiff !== 0) return periodDiff
    return a.instructorName.localeCompare(b.instructorName, "ru")
  })

  const totalDifference = allCorrections.reduce((s, c) => s + c.difference, 0)

  return NextResponse.json({
    corrections: allCorrections,
    totals: { totalDifference },
  })
}
