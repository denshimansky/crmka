import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 6.1. Зарплата педагогов */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const instructorId = searchParams.get("instructorId")

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  // Instructors
  const instrWhere: any = { tenantId, deletedAt: null, role: "instructor" }
  if (instructorId) instrWhere.id = instructorId

  const instructors = await db.employee.findMany({
    where: instrWhere,
    select: { id: true, firstName: true, lastName: true },
  })

  const instrIds = instructors.map((i) => i.id)

  // Salary accrued from attendances
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: {
        date: { gte: dateFrom, lte: dateTo },
        instructorId: { in: instrIds },
      },
      instructorPayEnabled: true,
    },
    select: {
      instructorPayAmount: true,
      lesson: { select: { instructorId: true, date: true } },
    },
  })

  // Adjustments
  const adjustments = await db.salaryAdjustment.findMany({
    where: {
      tenantId,
      periodYear: year,
      periodMonth: month,
      employeeId: { in: instrIds },
    },
    select: { employeeId: true, type: true, amount: true },
  })

  // Payments
  const salaryPayments = await db.salaryPayment.findMany({
    where: {
      tenantId,
      periodYear: year,
      periodMonth: month,
      employeeId: { in: instrIds },
    },
    select: { employeeId: true, amount: true, periodHalf: true },
  })

  // Aggregate per instructor
  const instrMap = new Map<
    string,
    {
      accrued: number
      accruedFirstHalf: number
      accruedSecondHalf: number
      bonusFirstHalf: number
      bonusSecondHalf: number
      penaltyFirstHalf: number
      penaltySecondHalf: number
      paidFirstHalf: number
      paidSecondHalf: number
    }
  >()

  for (const i of instructors) {
    instrMap.set(i.id, {
      accrued: 0,
      accruedFirstHalf: 0,
      accruedSecondHalf: 0,
      bonusFirstHalf: 0,
      bonusSecondHalf: 0,
      penaltyFirstHalf: 0,
      penaltySecondHalf: 0,
      paidFirstHalf: 0,
      paidSecondHalf: 0,
    })
  }

  for (const a of attendances) {
    const iId = a.lesson.instructorId
    const s = instrMap.get(iId)
    if (!s) continue
    const amt = Number(a.instructorPayAmount)
    s.accrued += amt
    const day = a.lesson.date.getUTCDate()
    if (day <= 15) s.accruedFirstHalf += amt
    else s.accruedSecondHalf += amt
  }

  for (const adj of adjustments) {
    const s = instrMap.get(adj.employeeId)
    if (!s) continue
    const amt = Number(adj.amount)
    // Adjustments don't have periodHalf in schema, distribute to second half by default
    if (adj.type === "bonus") s.bonusSecondHalf += amt
    else s.penaltySecondHalf += amt
  }

  for (const p of salaryPayments) {
    const s = instrMap.get(p.employeeId)
    if (!s) continue
    const amt = Number(p.amount)
    if (p.periodHalf === 1) s.paidFirstHalf += amt
    else s.paidSecondHalf += amt
  }

  const data = instructors.map((i) => {
    const s = instrMap.get(i.id)!
    const totalAccrued = s.accrued
    const totalBonus = s.bonusFirstHalf + s.bonusSecondHalf
    const totalPenalty = s.penaltyFirstHalf + s.penaltySecondHalf
    const totalPaid = s.paidFirstHalf + s.paidSecondHalf
    const remaining = totalAccrued + totalBonus - totalPenalty - totalPaid

    return {
      instructorId: i.id,
      instructorName: [i.lastName, i.firstName].filter(Boolean).join(" "),
      accrued: totalAccrued,
      accruedFirstHalf: s.accruedFirstHalf,
      accruedSecondHalf: s.accruedSecondHalf,
      bonusFirstHalf: s.bonusFirstHalf,
      bonusSecondHalf: s.bonusSecondHalf,
      penaltyFirstHalf: s.penaltyFirstHalf,
      penaltySecondHalf: s.penaltySecondHalf,
      paidFirstHalf: s.paidFirstHalf,
      paidSecondHalf: s.paidSecondHalf,
      totalPaid,
      remaining,
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => b.accrued - a.accrued),
    metadata: {
      totalAccrued: data.reduce((s, d) => s + d.accrued, 0),
      totalPaid: data.reduce((s, d) => s + d.totalPaid, 0),
      totalRemaining: data.reduce((s, d) => s + d.remaining, 0),
      year,
      month,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
