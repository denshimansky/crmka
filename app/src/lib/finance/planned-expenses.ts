import { Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface PlannedExpenseWithFact {
  id: string
  periodYear: number
  periodMonth: number
  categoryId: string
  categoryName: string
  branchId: string | null
  branchName: string | null
  plannedAmount: number
  /** Факт — сумма реальных расходов (Expense) за тот же период/категорию/филиал. */
  actualAmount: number
  comment: string | null
}

export interface PlannedExpenseFilters {
  tenantId: string
  year?: number
  month?: number
  categoryId?: string | null
  branchId?: string | null
}

/**
 * Плановые расходы с подсчётом факта. Единый источник для страницы
 * /finance/planned-expenses (через API) и виджета дашборда «Плановые расходы»,
 * чтобы цифры План/Факт/Отклонение совпадали один-в-один.
 *
 * Факт считается только когда заданы и год, и месяц: суммируем Expense за этот
 * месяц по тем же категориям. Для плана с привязкой к филиалу берём только
 * расходы, отнесённые к этому филиалу; для «общего по компании» (branchId=null)
 * — все расходы категории за период.
 */
export async function computePlannedExpensesWithFact(
  db: DB,
  filters: PlannedExpenseFilters,
): Promise<PlannedExpenseWithFact[]> {
  const { tenantId, year, month, categoryId, branchId } = filters

  const where: Prisma.PlannedExpenseWhereInput = { tenantId }
  if (year != null) where.periodYear = year
  if (month != null) where.periodMonth = month
  if (categoryId) where.categoryId = categoryId
  if (branchId) where.branchId = branchId

  const items = await db.plannedExpense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  // Считаем факт: суммируем Expense за тот же период по тем же категориям.
  const factByKey = new Map<string, number>()
  if (items.length > 0 && year != null && month != null) {
    const periodStart = new Date(Date.UTC(year, month - 1, 1))
    const periodEnd = new Date(Date.UTC(year, month, 1))
    const expenses = await db.expense.findMany({
      where: {
        tenantId,
        categoryId: { in: [...new Set(items.map((i) => i.categoryId))] },
        date: { gte: periodStart, lt: periodEnd },
        deletedAt: null,
      },
      include: { branches: { select: { branchId: true } } },
    })
    for (const item of items) {
      let sum = 0
      for (const e of expenses) {
        if (e.categoryId !== item.categoryId) continue
        if (item.branchId) {
          if (!e.branches.some((b) => b.branchId === item.branchId)) continue
        }
        sum += Number(e.amount)
      }
      factByKey.set(item.id, sum)
    }
  }

  return items.map((i) => ({
    id: i.id,
    periodYear: i.periodYear,
    periodMonth: i.periodMonth,
    categoryId: i.categoryId,
    categoryName: i.category.name,
    branchId: i.branchId,
    branchName: i.branch?.name ?? null,
    plannedAmount: Number(i.plannedAmount),
    actualAmount: factByKey.get(i.id) ?? 0,
    comment: i.comment,
  }))
}
