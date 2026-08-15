import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import {
  expenseAmountInWindow,
  expenseFetchWindow,
} from "@/lib/expense-amortization"
import { branchShare } from "@/lib/pnl-allocation"
import { fetchCellRevenue } from "@/lib/pnl-cell-revenue"
import { loadPieceRatioMap, makeRatioLookup, ymKeyOf } from "@/lib/salary/recognized-piece"

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
          date: true,
          instructorId: true,
          substituteInstructorId: true,
          group: {
            select: {
              direction: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })

  // Сделка в ОПИУ — «по выплате, в месяц работы»: домножаем на коэффициент оплаченной
  // части (FIFO). См. lib/salary/recognized-piece.
  const pieceRatio = makeRatioLookup(
    await loadPieceRatioMap(
      tenantId,
      ymKeyOf(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth() + 1),
      ymKeyOf(dateTo.getUTCFullYear(), dateTo.getUTCMonth() + 1),
    ),
  )

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
      prev.salary +=
        Number(a.instructorPayAmount) *
        pieceRatio(a.lesson.substituteInstructorId ?? a.lesson.instructorId, a.lesson.date)
    }
    dirMap.set(dirId, prev)
  }

  const totalRevenue = Array.from(dirMap.values()).reduce(
    (s, d) => s + d.revenue,
    0
  )

  // === Expenses ===
  // Окно выборки расширяем в ОБЕ стороны — расход с single_period/amortized мог быть оплачен
  // раньше месяца признания (аренда вперёд) ИЛИ позже (начисление раньше оплаты, напр. взносы
  // за июль оплачены в августе). expenseAmountInWindow отбирает точные доли внутри окна.
  const { gte: expensesFrom, lte: expensesTo } = expenseFetchWindow(
    dateFrom.getUTCFullYear(), dateFrom.getUTCMonth() + 1,
    dateTo.getUTCFullYear(), dateTo.getUTCMonth() + 1,
  )
  // Расходы тянем по всей сети (без some:{branchId}): в срезе филиала берём ДОЛЮ расхода
  // на филиал (∝ выручке сети) — иначе общие/оклад-твин расходы выпадут, а мультифилиальные
  // задвоятся. Доля считается ядром аллокации (branchShare) ниже.
  const expenses = await db.expense.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: expensesFrom, lte: expensesTo },
    },
    include: {
      category: { select: { name: true, isSalary: true, isVariable: true } },
      branches: { select: { branchId: true, directionId: true } },
    },
  })

  const fromY = dateFrom.getUTCFullYear()
  const fromM = dateFrom.getUTCMonth() + 1
  const toY = dateTo.getUTCFullYear()
  const toM = dateTo.getUTCMonth() + 1

  // Веса аллокации для среза филиала (по всей сети). Без филиала расход берётся целиком.
  const cellRev = branchId ? await fetchCellRevenue(tenantId, dateFrom, dateTo) : null

  // Split expenses: variable (linked to direction) vs fixed (to distribute)
  let totalFixed = 0
  const directExpensesByDir = new Map<string, number>()

  for (const e of expenses) {
    const windowed = expenseAmountInWindow(e, fromY, fromM, toY, toM)
    if (windowed === 0) continue
    const amount = branchId && cellRev
      ? branchShare(windowed, e.branches.map((b) => ({ branchId: b.branchId, directionId: b.directionId })), cellRev, branchId)
      : windowed
    if (amount === 0) continue
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

  // Прочие доходы (вне абонементов) не привязаны к направлению — учитываются
  // только в общих итогах. По дате платежа, refund исключаем.
  const otherIncomePayments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      subscriptionId: null,
      incomeCategoryId: { not: null },
      notInPnl: false, // «Не учитывать в ОПИУ» (баг #105)
      type: { in: ["incoming", "transfer_in"] },
      date: { gte: dateFrom, lte: dateTo },
    },
    select: {
      amount: true,
      incomeCategory: { select: { id: true, name: true } },
    },
  })
  // В срезе филиала прочий доход разносится ∝ выручке (как в основном P&L) — берём долю.
  const otherIncomeMap = new Map<string, { categoryId: string; categoryName: string; amount: number }>()
  for (const p of otherIncomePayments) {
    if (!p.incomeCategory) continue
    const amt = branchId && cellRev ? branchShare(Number(p.amount), [], cellRev, branchId) : Number(p.amount)
    if (amt === 0) continue
    const key = p.incomeCategory.id
    const prev = otherIncomeMap.get(key) || { categoryId: key, categoryName: p.incomeCategory.name, amount: 0 }
    prev.amount += amt
    otherIncomeMap.set(key, prev)
  }
  const otherIncomeByCategory = Array.from(otherIncomeMap.values()).sort((a, b) => b.amount - a.amount)
  const totalOtherIncome = otherIncomeByCategory.reduce((s, x) => s + x.amount, 0)

  // Totals
  const totalSalary = rows.reduce((s, r) => s + r.salary, 0)
  const totalDirectExpenses = rows.reduce((s, r) => s + r.directExpenses, 0)
  const totalVariableCosts = rows.reduce((s, r) => s + r.variableCosts, 0)
  const totalMargin = rows.reduce((s, r) => s + r.margin, 0)
  const totalNetProfitDirections = rows.reduce((s, r) => s + r.netProfit, 0)
  const totalNetProfit = totalNetProfitDirections + totalOtherIncome
  const totalIncome = totalRevenue + totalOtherIncome
  const totalProfitability =
    totalIncome > 0 ? (totalNetProfit / totalIncome) * 100 : 0

  return NextResponse.json({
    data: {
      rows,
      totals: {
        revenue: totalRevenue,
        otherIncome: totalOtherIncome,
        otherIncomeByCategory,
        totalIncome,
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
