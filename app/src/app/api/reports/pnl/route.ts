import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import { distributeFixedExpenses, type FixedExpenseItem } from "@/lib/expense-distribution"
import {
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"
import { isUnscoped, scopeExpense, scopePaymentByAccount } from "@/lib/branch-scope"

/** 7.2. Финансовый результат (P&L) с учётом периода признания расхода. */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams, scope } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const rawBranchId = searchParams.get("branchId")
  // ADM-04: пересечение явного фильтра и scope.
  const branchId =
    rawBranchId && (isUnscoped(scope) || scope.branchIds.includes(rawBranchId))
      ? rawBranchId
      : null
  const showPercent = searchParams.get("showPercent") === "true" // 7.4 toggle

  // Выручка = списания за период (chargeAmount), как в ОПИУ — по дате занятия.
  // ADM-04: фильтр группы по branchId либо по scope сессии.
  const effectiveBranchIds = branchId
    ? [branchId]
    : isUnscoped(scope)
      ? null
      : scope.branchIds
  const attWhere: any = {
    tenantId,
    lesson: {
      date: { gte: dateFrom, lte: dateTo },
      ...(effectiveBranchIds ? { group: { branchId: { in: effectiveBranchIds } } } : {}),
    },
    attendanceType: { countsAsRevenue: true },
  }

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
  // Прочий доход привязки к клиенту не имеет — скоупим по ВИДИМОМУ счёту:
  // движения по общим счетам скоуп-админу в P&L не показываем (23.07.2026).
  const paymentScopeFilter = scopePaymentByAccount(scope)
  const otherIncomePaymentsBase: any = {
    tenantId,
    deletedAt: null,
    subscriptionId: null,
    incomeCategoryId: { not: null },
    type: { in: ["incoming", "transfer_in"] },
    date: { gte: dateFrom, lte: dateTo },
  }
  const otherIncomePayments = await db.payment.findMany({
    where:
      Object.keys(paymentScopeFilter).length > 0
        ? { AND: [otherIncomePaymentsBase, paymentScopeFilter] }
        : otherIncomePaymentsBase,
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
  // ADM-04: scope расходов (если не перекрыт явным branchId).
  const expenseScopeFilter = scopeExpense(scope)
  const finalExpWhere =
    Object.keys(expenseScopeFilter).length > 0 && !branchId
      ? { AND: [expWhere, expenseScopeFilter] }
      : expWhere

  const expenses = await db.expense.findMany({
    where: finalExpWhere,
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      // Направление берём из ExpenseBranch — если указано, относим расход напрямую
      // к этому направлению в распределении (минуя пропорциональный split).
      branches: { select: { directionId: true } },
    },
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
    // Если у расхода указано направление — относим целиком к нему (не распределяем).
    directDirectionId: string | null
  }
  const slices: ExpenseSlice[] = []
  for (const e of expenses) {
    const inWindow = expenseAmountInWindow(e, fromY, fromM, toY, toM)
    if (inWindow === 0) continue
    // Все ExpenseBranch одного расхода имеют одинаковый directionId — берём первый.
    const directDirectionId =
      e.branches.find((b) => b.directionId)?.directionId ?? null
    slices.push({
      categoryId: e.category.id,
      categoryName: e.category.name,
      isSalary: e.category.isSalary,
      isVariable: e.category.isVariable,
      amountInWindow: inWindow,
      directDirectionId,
    })
  }

  const totalExpenses = slices.reduce((s, x) => s + x.amountInWindow, 0)

  // Начисленная ЗП инструкторов (сдельная) = факт занятий по дате занятия.
  // Оклад окладников больше НЕ начисляется здесь фантомно: он приходит настоящим
  // расходом (категория «Зарплата окладников», твин выплаты) и уже учтён в totalExpenses.
  // Премии/штрафы окладников также приходят суммой выплаты (в твине), поэтому
  // SalaryAdjustment в ОПИУ здесь не суммируется — иначе двойной счёт.
  const salaryAtt = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      instructorPayEnabled: true,
      ...(branchId ? { lesson: { date: { gte: dateFrom, lte: dateTo }, group: { branchId } } } : {}),
    },
    select: { instructorPayAmount: true },
  })
  const totalSalaryAccrued = salaryAtt.reduce((s, a) => s + Number(a.instructorPayAmount), 0)

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

  // FIN-16 + Option B: распределение постоянных расходов.
  // Постоянные расходы с явно указанным directionId относим напрямую (без split).
  // Остальные — распределяем пропорционально выручке направлений (как раньше).
  const fixedSlices = slices.filter((s) => !s.isVariable)
  const directFixed = fixedSlices.filter((s) => s.directDirectionId)
  const undirectedFixed = fixedSlices.filter((s) => !s.directDirectionId)

  const fixedExpenseItems: FixedExpenseItem[] = undirectedFixed.reduce<FixedExpenseItem[]>((acc, s) => {
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
  // Направления могут быть и без выручки (если у них только direct-расходы) —
  // добавим их в карту с нулевой выручкой, чтобы distributedByDirection их видел.
  for (const s of directFixed) {
    if (s.directDirectionId && !(s.directDirectionId in revenueMap)) {
      revenueMap[s.directDirectionId] = 0
    }
  }

  const distribution = distributeFixedExpenses(fixedExpenseItems, revenueMap)

  // Прямые (direct) расходы добавляем к distributed-результату «как есть».
  type DistItem = { category: string; originalAmount: number; distributedAmount: number; share: number; direct?: boolean }
  const directByDirection: Record<string, DistItem[]> = {}
  const directTotalByDirection: Record<string, number> = {}
  for (const s of directFixed) {
    const dirId = s.directDirectionId!
    if (!directByDirection[dirId]) directByDirection[dirId] = []
    directByDirection[dirId].push({
      category: s.categoryName,
      originalAmount: s.amountInWindow,
      distributedAmount: s.amountInWindow,
      share: 100,
      direct: true,
    })
    directTotalByDirection[dirId] = (directTotalByDirection[dirId] ?? 0) + s.amountInWindow
  }

  const allDirectionIds = new Set<string>([
    ...Object.keys(distribution.byKey),
    ...Object.keys(directByDirection),
    ...Object.keys(revenueByDirection),
  ])
  const distributionByDirection = Array.from(allDirectionIds).map((dirId) => {
    const distItems: DistItem[] = distribution.byKey[dirId] ?? []
    const directItems: DistItem[] = directByDirection[dirId] ?? []
    const distributedTotal =
      (distribution.totalByKey[dirId] ?? 0) + (directTotalByDirection[dirId] ?? 0)
    return {
      directionId: dirId,
      directionName: revenueByDirection[dirId]?.name ?? dirId,
      revenue: revenueByDirection[dirId]?.revenue ?? 0,
      revenueShare:
        revenue > 0 ? Math.round(((revenueByDirection[dirId]?.revenue ?? 0) / revenue) * 1000) / 10 : 0,
      distributedFixedExpenses: Math.round(distributedTotal * 100) / 100,
      items: [
        ...directItems.map((item) => ({
          category: item.category,
          originalAmount: item.originalAmount,
          distributedAmount: item.distributedAmount,
          share: item.share,
          direct: true,
        })),
        ...distItems.map((item) => ({
          category: item.category,
          originalAmount: item.originalAmount,
          distributedAmount: item.distributedAmount,
          share: item.share,
          direct: false,
        })),
      ],
    }
  })
  const totalFixedWithDirect =
    distribution.totalFixed + directFixed.reduce((s, x) => s + x.amountInWindow, 0)

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
        totalFixed: totalFixedWithDirect,
        byDirection: distributionByDirection,
      },
    },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
