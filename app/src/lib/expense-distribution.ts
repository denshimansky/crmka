/**
 * FIN-16: Автораспределение постоянных расходов пропорционально выручке.
 *
 * Формула:
 *   direction_share = direction_revenue / total_revenue
 *   distributed_amount = fixed_expense_amount × direction_share
 *
 * Если total_revenue = 0, расходы распределяются поровну.
 */

export interface FixedExpenseItem {
  /** Expense ID */
  id: string
  /** Category name */
  category: string
  /** Total amount of the fixed expense */
  amount: number
}

export interface RevenueByKey {
  /** direction/branch id → revenue */
  [key: string]: number
}

export interface DistributedExpenseItem {
  /** Original expense id */
  expenseId: string
  /** Category name */
  category: string
  /** Original full amount */
  originalAmount: number
  /** Distributed amount for this key */
  distributedAmount: number
  /** Share (0–1) */
  share: number
}

export interface DistributionResult {
  /** key (direction/branch id) → distributed expense items */
  byKey: Record<string, DistributedExpenseItem[]>
  /** key → total distributed fixed expenses */
  totalByKey: Record<string, number>
  /** Total fixed expenses across all keys */
  totalFixed: number
}

/**
 * Distribute fixed expenses proportionally to revenue.
 *
 * @param fixedExpenses - array of fixed expenses to distribute
 * @param revenueByKey  - map of key (directionId/branchId) → revenue amount
 * @returns distribution result with amounts per key
 */
export function distributeFixedExpenses(
  fixedExpenses: FixedExpenseItem[],
  revenueByKey: RevenueByKey,
): DistributionResult {
  const keys = Object.keys(revenueByKey)
  const totalRevenue = Object.values(revenueByKey).reduce((s, v) => s + v, 0)
  const totalFixed = fixedExpenses.reduce((s, e) => s + e.amount, 0)

  const byKey: Record<string, DistributedExpenseItem[]> = {}
  const totalByKey: Record<string, number> = {}

  for (const key of keys) {
    byKey[key] = []
    totalByKey[key] = 0
  }

  if (keys.length === 0) {
    return { byKey, totalByKey, totalFixed }
  }

  for (const expense of fixedExpenses) {
    // Track distributed amounts for rounding correction
    let distributed = 0

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      let share: number
      let amount: number

      if (totalRevenue === 0) {
        // Equal distribution when no revenue
        share = 1 / keys.length
      } else {
        share = revenueByKey[key] / totalRevenue
      }

      if (i === keys.length - 1) {
        // Last key gets the remainder to avoid rounding errors
        amount = Math.round((expense.amount - distributed) * 100) / 100
      } else {
        amount = Math.round(expense.amount * share * 100) / 100
        distributed += amount
      }

      byKey[key].push({
        expenseId: expense.id,
        category: expense.category,
        originalAmount: expense.amount,
        distributedAmount: amount,
        share: Math.round(share * 1000) / 10, // percentage with 1 decimal
      })

      totalByKey[key] = Math.round((totalByKey[key] + amount) * 100) / 100
    }
  }

  return { byKey, totalByKey, totalFixed }
}

/**
 * Compute revenue breakdown by direction from attendance data.
 *
 * @param attendances - array with chargeAmount and direction info
 * @returns map of directionId → { name, revenue }
 */
export function computeRevenueByDirection(
  attendances: Array<{
    chargeAmount: number | { toNumber?: () => number }
    directionId: string
    directionName: string
  }>,
): Record<string, { name: string; revenue: number }> {
  const result: Record<string, { name: string; revenue: number }> = {}

  for (const att of attendances) {
    const amount = typeof att.chargeAmount === "number"
      ? att.chargeAmount
      : Number(att.chargeAmount)

    if (!result[att.directionId]) {
      result[att.directionId] = { name: att.directionName, revenue: 0 }
    }
    result[att.directionId].revenue += amount
  }

  return result
}
