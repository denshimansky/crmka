import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** FIN-15: P&L по направлениям */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // === Revenue by direction (attended lessons with countsAsRevenue) ===
  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
    attendanceType: { countsAsRevenue: true },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      chargeAmount: true,
      instructorPayAmount: true,
      instructorPayEnabled: true,
      lesson: {
        select: {
          group: {
            select: {
              direction: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })

  // Group by direction
  const dirMap = new Map<
    string,
    { name: string; revenue: number; salary: number }
  >()

  for (const a of attendances) {
    const dirId = a.lesson.group.direction.id
    const dirName = a.lesson.group.direction.name
    const prev = dirMap.get(dirId) || { name: dirName, revenue: 0, salary: 0 }
    prev.revenue += Number(a.chargeAmount)
    if (a.instructorPayEnabled) {
      prev.salary += Number(a.instructorPayAmount)
    }
    dirMap.set(dirId, prev)
  }

  const totalRevenue = Array.from(dirMap.values()).reduce(
    (s, d) => s + d.revenue,
    0
  )

  // === Expenses ===
  const expWhere: any = {
    tenantId,
    deletedAt: null,
    date: { gte: dateFrom, lte: dateTo },
  }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    include: {
      category: { select: { name: true, isSalary: true, isVariable: true } },
      branches: { select: { directionId: true } },
    },
  })

  // Split expenses: variable (linked to direction) vs fixed (to distribute)
  let totalFixed = 0
  const directExpensesByDir = new Map<string, number>()

  for (const e of expenses) {
    const amount = Number(e.amount)
    const isVariable = e.category.isVariable

    // Check if expense is linked to a specific direction
    const linkedDirIds = e.branches
      .map((b) => b.directionId)
      .filter(Boolean) as string[]

    if (isVariable && linkedDirIds.length > 0) {
      // Variable expense linked to directions — split evenly among linked directions
      const perDir = amount / linkedDirIds.length
      for (const dirId of linkedDirIds) {
        directExpensesByDir.set(
          dirId,
          (directExpensesByDir.get(dirId) || 0) + perDir
        )
      }
    } else {
      // Fixed expense or variable without direction link — distribute proportionally
      totalFixed += amount
    }
  }

  // === Build direction rows ===
  // Collect all direction IDs (from revenue + from direct expenses)
  const allDirIds = new Set([...dirMap.keys(), ...directExpensesByDir.keys()])

  const rows = Array.from(allDirIds).map((dirId) => {
    const dirData = dirMap.get(dirId) || {
      name: "Неизвестное направление",
      revenue: 0,
      salary: 0,
    }
    const revenue = dirData.revenue
    const salary = dirData.salary
    const directExpenses = directExpensesByDir.get(dirId) || 0
    const variableCosts = salary + directExpenses

    // Fixed distributed proportionally to revenue
    const revenueShare = totalRevenue > 0 ? revenue / totalRevenue : 0
    const fixedDistributed = totalFixed * revenueShare

    const margin = revenue - variableCosts
    const netProfit = revenue - variableCosts - fixedDistributed
    const profitability = revenue > 0 ? (netProfit / revenue) * 100 : 0

    return {
      directionId: dirId,
      directionName: dirData.name,
      revenue,
      salary,
      directExpenses,
      variableCosts,
      fixedDistributed: Math.round(fixedDistributed * 100) / 100,
      margin,
      netProfit: Math.round(netProfit * 100) / 100,
      profitability: Math.round(profitability * 10) / 10,
      revenueShare: pct(revenue, totalRevenue),
    }
  })

  rows.sort((a, b) => b.revenue - a.revenue)

  // Totals
  const totalSalary = rows.reduce((s, r) => s + r.salary, 0)
  const totalDirectExpenses = rows.reduce((s, r) => s + r.directExpenses, 0)
  const totalVariableCosts = rows.reduce((s, r) => s + r.variableCosts, 0)
  const totalMargin = rows.reduce((s, r) => s + r.margin, 0)
  const totalNetProfit = rows.reduce((s, r) => s + r.netProfit, 0)
  const totalProfitability =
    totalRevenue > 0 ? (totalNetProfit / totalRevenue) * 100 : 0

  return NextResponse.json({
    data: {
      rows,
      totals: {
        revenue: totalRevenue,
        salary: totalSalary,
        directExpenses: totalDirectExpenses,
        variableCosts: totalVariableCosts,
        fixedDistributed: totalFixed,
        margin: totalMargin,
        netProfit: Math.round(totalNetProfit * 100) / 100,
        profitability: Math.round(totalProfitability * 10) / 10,
      },
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
