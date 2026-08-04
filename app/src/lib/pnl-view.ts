// Числовая агрегация отчёта P&L (ОПИУ) за окно месяцев. Чистая функция без БД:
// страница один раз вытягивает сырые строки за весь период, затем считает вид за весь
// период И за каждый месяц одним и тем же кодом (декомпозиция карточек по месяцам).
//
// Инвариант (покрыт тестом): для аддитивных величин (выручка, расходы, ЗП, прочие доходы)
// сумма помесячных видов равна виду за весь период. Производные доли (рентабельность,
// распределение постоянных) считаются в каждом окне отдельно и НЕ обязаны складываться.

import { distributeFixedExpenses, type FixedExpenseItem } from "./expense-distribution"
import { expenseAmountInWindow, type ExpenseLike } from "./expense-amortization"

/** Ключ месяца: year*12 + (month-1). Удобно сравнивать диапазоны. */
export function monthKey(year: number, month1to12: number): number {
  return year * 12 + (month1to12 - 1)
}

/** Ключ месяца из даты (UTC) — совпадает с логикой expandExpenseToMonths. */
export function monthKeyOfDate(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

export interface PnlAttendanceRow {
  chargeAmount: number
  ymKey: number
  directionId: string
  directionName: string
}
export interface PnlSalaryRow {
  amount: number
  ymKey: number
}
export interface PnlIncomeRow {
  amount: number
  ymKey: number
  categoryId: string
  categoryName: string
}
export interface PnlExpenseRow extends ExpenseLike {
  categoryId: string
  categoryName: string
  isSalary: boolean
  isVariable: boolean
  /** directionId, если расход отнесён к направлению напрямую (Option B). */
  directDirectionId: string | null
}

export interface PnlExpenseCategory {
  name: string
  categoryId: string
  amount: number
  isSalary: boolean
  isVariable: boolean
}

export interface PnlDirectionEntry {
  directionId: string
  name: string
  revenue: number
  revenueShare: number
  distributedFixed: number
  directFixedItems: { category: string; amount: number }[]
}

export interface PnlView {
  revenue: number
  otherIncomeByCategory: { id: string; name: string; amount: number }[]
  totalOtherIncome: number
  totalSalaryAccrued: number
  expenseCategories: PnlExpenseCategory[]
  totalExpenses: number
  variableExpenses: number
  fixedExpenses: number
  totalVariableCosts: number
  margin: number
  totalIncome: number
  netProfit: number
  profitability: number
  distributionArticles: { category: string; amount: number; percentOfRevenue: number }[]
  directionEntries: PnlDirectionEntry[]
  /** Разложенные постоянные по направлениям (для тултипа карточки направлений). */
  distributionByKey: Record<string, { category: string; distributedAmount: number }[]>
}

export interface PnlRawData {
  attendances: PnlAttendanceRow[]
  salary: PnlSalaryRow[]
  otherIncome: PnlIncomeRow[]
  expenses: PnlExpenseRow[]
  /** id направления → имя (для направлений, у которых есть только прямые расходы). */
  directionNameById: Map<string, string>
}

/** Считает P&L за окно [fromKey..toKey] (включительно) из заранее вытянутых строк. */
export function computePnlView(fromKey: number, toKey: number, raw: PnlRawData): PnlView {
  const inWindow = (k: number) => k >= fromKey && k <= toKey

  // === Выручка + по направлениям ===
  let revenue = 0
  const revenueByDirection: Record<string, { name: string; revenue: number }> = {}
  for (const a of raw.attendances) {
    if (!inWindow(a.ymKey)) continue
    revenue += a.chargeAmount
    const d = revenueByDirection[a.directionId] || { name: a.directionName, revenue: 0 }
    d.revenue += a.chargeAmount
    revenueByDirection[a.directionId] = d
  }

  // === Прочие доходы ===
  const otherIncomeMap = new Map<string, { id: string; name: string; amount: number }>()
  for (const p of raw.otherIncome) {
    if (!inWindow(p.ymKey)) continue
    const prev = otherIncomeMap.get(p.categoryId) || { id: p.categoryId, name: p.categoryName, amount: 0 }
    prev.amount += p.amount
    otherIncomeMap.set(p.categoryId, prev)
  }
  const otherIncomeByCategory = Array.from(otherIncomeMap.values()).sort((a, b) => b.amount - a.amount)
  const totalOtherIncome = otherIncomeByCategory.reduce((s, x) => s + x.amount, 0)

  // === ЗП (начислено из посещений) ===
  let totalSalaryAccrued = 0
  for (const s of raw.salary) if (inWindow(s.ymKey)) totalSalaryAccrued += s.amount

  // === Расходы: доля каждого в окне (с учётом периода признания) ===
  const [fY, fM] = keyToYm(fromKey)
  const [tY, tM] = keyToYm(toKey)
  const expenseSlices = raw.expenses
    .map((e) => ({
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      isSalary: e.isSalary,
      isVariable: e.isVariable,
      amount: expenseAmountInWindow(e, fY, fM, tY, tM),
      directDirectionId: e.directDirectionId,
    }))
    .filter((s) => s.amount > 0)

  const totalExpenses = expenseSlices.reduce((s, x) => s + x.amount, 0)

  const expenseByCategory = new Map<string, PnlExpenseCategory>()
  for (const s of expenseSlices) {
    const prev = expenseByCategory.get(s.categoryName) || {
      name: s.categoryName, categoryId: s.categoryId, amount: 0, isSalary: s.isSalary, isVariable: s.isVariable,
    }
    prev.amount += s.amount
    expenseByCategory.set(s.categoryName, prev)
  }
  const expenseCategories = Array.from(expenseByCategory.values())

  // === Производные ===
  const variableExpenses = expenseSlices.filter((s) => s.isVariable).reduce((sum, s) => sum + s.amount, 0)
  const fixedExpenses = totalExpenses - variableExpenses
  const totalVariableCosts = variableExpenses + totalSalaryAccrued
  const margin = revenue - totalVariableCosts
  const totalIncome = revenue + totalOtherIncome
  const netProfit = totalIncome - totalExpenses - totalSalaryAccrued
  const profitability = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

  // === Распределение постоянных расходов по направлениям ===
  const fixedSlices = expenseSlices.filter((s) => !s.isVariable)
  const directFixedSlices = fixedSlices.filter((s) => s.directDirectionId)
  const undirectedFixedSlices = fixedSlices.filter((s) => !s.directDirectionId)

  const fixedExpenseItems: FixedExpenseItem[] = undirectedFixedSlices.reduce<FixedExpenseItem[]>((acc, s) => {
    const existing = acc.find((x) => x.id === s.categoryId)
    if (existing) existing.amount += s.amount
    else acc.push({ id: s.categoryId, category: s.categoryName, amount: s.amount })
    return acc
  }, [])

  const revenueMap: Record<string, number> = {}
  for (const [dirId, info] of Object.entries(revenueByDirection)) revenueMap[dirId] = info.revenue
  const distribution = distributeFixedExpenses(fixedExpenseItems, revenueMap)

  const directFixedByDirection: Record<string, { items: { category: string; amount: number }[]; total: number }> = {}
  for (const s of directFixedSlices) {
    const dirId = s.directDirectionId!
    if (!directFixedByDirection[dirId]) directFixedByDirection[dirId] = { items: [], total: 0 }
    directFixedByDirection[dirId].items.push({ category: s.categoryName, amount: s.amount })
    directFixedByDirection[dirId].total += s.amount
  }

  const directionIdSet = new Set<string>([
    ...Object.keys(revenueByDirection),
    ...Object.keys(directFixedByDirection),
  ])
  const directionEntries: PnlDirectionEntry[] = Array.from(directionIdSet)
    .map((dirId) => {
      const revenueInfo = revenueByDirection[dirId]
      const directInfo = directFixedByDirection[dirId]
      const dirRevenue = revenueInfo?.revenue ?? 0
      const distributedFixedShare = distribution.totalByKey[dirId] ?? 0
      const directFixed = directInfo?.total ?? 0
      return {
        directionId: dirId,
        name: revenueInfo?.name ?? raw.directionNameById.get(dirId) ?? dirId,
        revenue: dirRevenue,
        revenueShare: revenue > 0 ? Math.round((dirRevenue / revenue) * 1000) / 10 : 0,
        distributedFixed: distributedFixedShare + directFixed,
        directFixedItems: directInfo?.items ?? [],
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  // === % распределения финреза ===
  const distributionArticles = [
    { category: "ЗП инструкторов", amount: totalSalaryAccrued },
    ...expenseCategories.map((v) => ({ category: v.name, amount: v.amount })),
  ]
    .filter((a) => a.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((a) => ({ ...a, percentOfRevenue: revenue > 0 ? Math.round((a.amount / revenue) * 1000) / 10 : 0 }))

  return {
    revenue,
    otherIncomeByCategory,
    totalOtherIncome,
    totalSalaryAccrued,
    expenseCategories,
    totalExpenses,
    variableExpenses,
    fixedExpenses,
    totalVariableCosts,
    margin,
    totalIncome,
    netProfit,
    profitability,
    distributionArticles,
    directionEntries,
    distributionByKey: distribution.byKey,
  }
}

function keyToYm(key: number): [number, number] {
  return [Math.floor(key / 12), (key % 12) + 1]
}

/** Список месяцев [from..to] включительно как {year, month, key, label}. */
export function enumerateMonths(
  fromYear: number, fromMonth: number, toYear: number, toMonth: number,
): { year: number; month: number; key: number; label: string }[] {
  const out: { year: number; month: number; key: number; label: string }[] = []
  const start = monthKey(fromYear, fromMonth)
  const end = monthKey(toYear, toMonth)
  for (let k = start; k <= end; k++) {
    const [y, m] = keyToYm(k)
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    out.push({ year: y, month: m, key: k, label })
  }
  return out
}
