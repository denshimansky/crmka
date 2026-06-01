import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import { distributeFixedExpenses, type FixedExpenseItem } from "@/lib/expense-distribution"
import {
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"

/** 7.2. Финансовый результат (P&L) с учётом периода признания расхода. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const showPercent = searchParams.get("showPercent") === "true" // 7.4 toggle

  // Выручка = списания за период (chargeAmount), как в ОПИУ — по дате занятия.
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
      lesson: {
        select: {
          group: {
            select: {
              directionId: true,
              direction: { select: { name: true } },
              branchId: true,
              branch: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  const revenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)

  // Выручка по направлениям (для FIN-16 — распределения постоянных расходов).
  const revenueByDirection: Record<string, { name: string; revenue: number }> = {}
  for (const a of attendances) {
    const dirId = a.lesson.group.directionId
    const dirName = a.lesson.group.direction.name
    if (!revenueByDirection[dirId]) {
      revenueByDirection[dirId] = { name: dirName, revenue: 0 }
    }
    revenueByDirection[dirId].revenue += Number(a.chargeAmount)
  }

  // Прочие доходы (вне абонементов): Payment без subscriptionId, с incomeCategoryId.
  // Учитываются по дате платежа (как в ДДС), refund исключаем. Разбивка по категориям
  // показывается отдельным блоком в P&L и входит в итоговый «Чистая прибыль».
  const otherIncomePayments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      subscriptionId: null,
      incomeCategoryId: { not: null },
      type: { in: ["incoming", "transfer_in"] },
      date: { gte: dateFrom, lte: dateTo },
    },
    select: {
      amount: true,
      incomeCategoryId: true,
      incomeCategory: { select: { id: true, name: true } },
    },
  })
  const otherIncomeByCategoryMap = new Map<string, { categoryId: string; categoryName: string; amount: number }>()
  for (const p of otherIncomePayments) {
    if (!p.incomeCategory) continue
    const key = p.incomeCategory.id
    const prev = otherIncomeByCategoryMap.get(key) || { categoryId: key, categoryName: p.incomeCategory.name, amount: 0 }
    prev.amount += Number(p.amount)
    otherIncomeByCategoryMap.set(key, prev)
  }
  const otherIncomeByCategory = Array.from(otherIncomeByCategoryMap.values()).sort((a, b) => b.amount - a.amount)
  const totalOtherIncome = otherIncomeByCategory.reduce((s, x) => s + x.amount, 0)

  // Расходы выбираем расширенным окном: расход с recognitionMode=amortized мог быть
  // оплачен сильно раньше окна отчёта, но раскладка может затрагивать текущий месяц.
  const expensesFrom = new Date(dateFrom)
  expensesFrom.setUTCMonth(expensesFrom.getUTCMonth() - AMORTIZATION_LOOKBACK_MONTHS)
  const expWhere: any = {
    tenantId,
    deletedAt: null,
    date: { gte: expensesFrom, lte: dateTo },
  }
  if (branchId) expWhere.branches = { some: { branchId } }

  const expenses = await db.expense.findMany({
    where: expWhere,
    include: { category: { select: { id: true, name: true, isSalary: true, isVariable: true } } },
  })

  const fromY = dateFrom.getUTCFullYear()
  const fromM = dateFrom.getUTCMonth() + 1
  const toY = dateTo.getUTCFullYear()
  const toM = dateTo.getUTCMonth() + 1

  // Для каждого расхода — сумма, попавшая в окно отчёта (с учётом раскладки).
  type ExpenseSlice = {
    categoryId: string
    categoryName: string
    isSalary: boolean
    isVariable: boolean
    amountInWindow: number
  }
  const slices: ExpenseSlice[] = []
  for (const e of expenses) {
    const inWindow = expenseAmountInWindow(e, fromY, fromM, toY, toM)
    if (inWindow === 0) continue
    slices.push({
      categoryId: e.category.id,
      categoryName: e.category.name,
      isSalary: e.category.isSalary,
      isVariable: e.category.isVariable,
      amountInWindow: inWindow,
    })
  }

  const totalExpenses = slices.reduce((s, x) => s + x.amountInWindow, 0)

  // Начисленная ЗП инструкторов = факт занятий (по дате занятия), как было.
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
      ...(branchId ? { lesson: { date: { gte: dateFrom, lte: dateTo }, group: { branchId } } } : {}),
    },
    select: { instructorPayAmount: true },
  })
  const instructorSalaryAccrued = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

  // Окладники: Employee.monthlySalary × (число месяцев в окне). Окно ОПИУ обычно = 1 месяц
  // (MonthPicker), но если кто-то задал диапазон — считаем по числу полных месяцев.
  const monthsInWindow =
    (toY - fromY) * 12 + (toM - fromM) + 1
  const salariedEmployees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, isActive: true, monthlySalary: { not: null } },
    select: { id: true, monthlySalary: true },
  })
  const monthlySalaryTotal = salariedEmployees.reduce(
    (s, e) => s + Number(e.monthlySalary ?? 0),
    0,
  )
  const fixedSalaryAccrued = monthlySalaryTotal * monthsInWindow

  // Премии / штрафы окладников и преподов за окно.
  const adjustments = await db.salaryAdjustment.findMany({
    where: {
      tenantId,
      periodYear: { gte: fromY, lte: toY },
      // Дополнительной фильтрации по месяцу не делаем — для одиночного месяца fromY=toY,
      // а в P&L UI окно почти всегда = 1 месяц.
    },
    select: { type: true, amount: true, periodYear: true, periodMonth: true },
  })
  let adjustBonus = 0
  let adjustPenalty = 0
  for (const adj of adjustments) {
    const k = adj.periodYear * 12 + (adj.periodMonth - 1)
    const fromKey = fromY * 12 + (fromM - 1)
    const toKey = toY * 12 + (toM - 1)
    if (k < fromKey || k > toKey) continue
    if (adj.type === "bonus") adjustBonus += Number(adj.amount)
    else adjustPenalty += Number(adj.amount)
  }

  const totalSalaryAccrued =
    instructorSalaryAccrued + fixedSalaryAccrued + adjustBonus - adjustPenalty

  // По категориям.
  const byCategory: Record<string, { amount: number; isSalary: boolean; isVariable: boolean }> = {}
  for (const s of slices) {
    if (!byCategory[s.categoryName]) {
      byCategory[s.categoryName] = { amount: 0, isSalary: s.isSalary, isVariable: s.isVariable }
    }
    byCategory[s.categoryName].amount += s.amountInWindow
  }

  const variableExpenses = slices.filter((s) => s.isVariable).reduce((sum, s) => sum + s.amountInWindow, 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const totalVariableCosts = variableExpenses + totalSalaryAccrued
  // Маржа считается только от основной выручки (списания за занятия) — прочие доходы
  // не относятся к маржинальности услуг, они идут отдельным блоком в конце P&L.
  const margin = revenue - totalVariableCosts
  const totalIncome = revenue + totalOtherIncome
  const netProfit = totalIncome - totalExpenses - totalSalaryAccrued
  // Рентабельность от полного дохода (выручка + прочие).
  const profitability = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

  const expenseRows = Object.entries(byCategory)
    .map(([category, v]) => ({
      category,
      amount: v.amount,
      isSalary: v.isSalary,
      isVariable: v.isVariable,
      percentOfRevenue: showPercent ? pct(v.amount, revenue) : undefined,
    }))
    .sort((a, b) => b.amount - a.amount)

  // FIN-16: распределение постоянных расходов по выручке направлений.
  const fixedExpenseItems: FixedExpenseItem[] = slices
    .filter((s) => !s.isVariable)
    .reduce<FixedExpenseItem[]>((acc, s) => {
      const existing = acc.find((x) => x.id === s.categoryId)
      if (existing) {
        existing.amount += s.amountInWindow
      } else {
        acc.push({ id: s.categoryId, category: s.categoryName, amount: s.amountInWindow })
      }
      return acc
    }, [])

  const revenueMap: Record<string, number> = {}
  for (const [dirId, info] of Object.entries(revenueByDirection)) {
    revenueMap[dirId] = info.revenue
  }

  const distribution = distributeFixedExpenses(fixedExpenseItems, revenueMap)

  const distributionByDirection = Object.entries(distribution.byKey).map(([dirId, items]) => ({
    directionId: dirId,
    directionName: revenueByDirection[dirId]?.name ?? dirId,
    revenue: revenueByDirection[dirId]?.revenue ?? 0,
    revenueShare: revenue > 0 ? Math.round(((revenueByDirection[dirId]?.revenue ?? 0) / revenue) * 1000) / 10 : 0,
    distributedFixedExpenses: distribution.totalByKey[dirId],
    items: items.map((item) => ({
      category: item.category,
      originalAmount: item.originalAmount,
      distributedAmount: item.distributedAmount,
      share: item.share,
    })),
  }))

  return NextResponse.json({
    data: {
      revenue,
      otherIncome: totalOtherIncome,
      otherIncomeByCategory,
      totalIncome,
      salaryAccrued: totalSalaryAccrued,
      variableExpenses,
      fixedExpenses,
      totalVariableCosts,
      margin,
      netProfit,
      profitability: Math.round(profitability * 10) / 10,
      expensesByCategory: expenseRows,
      fixedExpenseDistribution: {
        totalFixed: distribution.totalFixed,
        byDirection: distributionByDirection,
      },
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
