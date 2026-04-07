import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 6.5. Мотивация администратора */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Get admins
  const adminWhere: any = { tenantId, deletedAt: null, role: "admin" }
  const admins = await db.employee.findMany({
    where: adminWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeBranches: { select: { branchId: true, branch: { select: { name: true } } } },
    },
  })

  const adminIds = admins.map((a) => a.id)

  // Trials completed by admin
  const trialWhere: any = {
    tenantId,
    status: "attended",
    scheduledDate: { gte: dateFrom, lte: dateTo },
    createdBy: { in: adminIds },
  }
  if (branchId) trialWhere.group = { branchId }

  const trials = await db.trialLesson.findMany({
    where: trialWhere,
    select: { createdBy: true },
  })

  // New sales by admin (first subscription created by admin)
  const newSales = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      firstPaymentDate: { gte: dateFrom, lte: dateTo },
      createdBy: { in: adminIds },
    },
    select: { createdBy: true, totalSubscriptionsCount: true },
  })

  // Aggregate per admin
  const data = admins.map((a) => {
    const trialsCount = trials.filter((t) => t.createdBy === a.id).length
    const sales = newSales.filter((c) => c.createdBy === a.id)
    const newClientSales = sales.filter((c) => c.totalSubscriptionsCount <= 1).length
    const upsales = sales.filter((c) => c.totalSubscriptionsCount > 1).length
    const branch = a.employeeBranches[0]?.branch?.name || "—"

    return {
      adminId: a.id,
      adminName: [a.lastName, a.firstName].filter(Boolean).join(" "),
      branch,
      trialsCompleted: trialsCount,
      newClientSales,
      upsales,
      totalSales: newClientSales + upsales,
    }
  })

  return NextResponse.json({
    data: data.sort((a, b) => b.totalSales - a.totalSales),
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
