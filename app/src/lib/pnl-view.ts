// Числовая агрегация отчёта P&L (ОПИУ) за окно месяцев. Чистая функция без БД:
// страница один раз вытягивает сырые строки за весь период, затем считает вид за весь
// период И за каждый месяц одним и тем же кодом (декомпозиция карточек по месяцам).
//
// Branch-aware: без branchFilter считает по всей сети (общий вид). С branchFilter —
// СРЕЗ филиала: выручка/ЗП берутся только по этому филиалу, а каждый расход и прочий
// доход разносится по филиалам ПРОПОРЦИОНАЛЬНО выручке (единое ядро lib/pnl-allocation),
// в срез попадает доля выбранного филиала. Общие расходы (без филиала), оклад-твины
// (branchId=null) и мультифилиальные расходы больше не выпадают/не задваиваются.
//
// Инвариант (покрыт тестом): для аддитивных величин (выручка, расходы, ЗП, прочие
// доходы) сумма помесячных видов == вид за весь период, и Σ срезов филиалов == общий
// вид. При branchFilter=undefined суммы идентичны прежним (аллокация не сужает).

import {
  buildCellRevenue,
  allRevenueCells,
  resolveTargets,
  distribute,
  NO_DIRECTION_ID,
  type AllocLink,
} from "./pnl-allocation"
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
  branchId: string
  directionId: string
  directionName: string
}
export interface PnlSalaryRow {
  amount: number
  ymKey: number
  branchId: string
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
  /** Связи расхода с (филиал, направление) — для аллокации по ячейкам. */
  links: AllocLink[]
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

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

/**
 * Считает P&L за окно [fromKey..toKey] (включительно) из заранее вытянутых строк.
 * `branchFilter` — срез по филиалу (id) или undefined (вся сеть).
 */
export function computePnlView(
  fromKey: number,
  toKey: number,
  raw: PnlRawData,
  branchFilter?: string,
): PnlView {
  const inWindow = (k: number) => k >= fromKey && k <= toKey
  const match = (b: string) => !branchFilter || b === branchFilter
  const [fY, fM] = keyToYm(fromKey)
  const [tY, tM] = keyToYm(toKey)

  // Веса аллокации — выручка ячеек (филиал, направление) по ВСЕЙ сети (не суженная
  // филиалом): доля филиала считается относительно всей сети/всех целевых филиалов.
  const cellRevenue = buildCellRevenue(
    raw.attendances
      .filter((a) => inWindow(a.ymKey))
      .map((a) => ({ branchId: a.branchId, directionId: a.directionId, amount: a.chargeAmount })),
  )

  // === Выручка + по направлениям (в срезе — только выбранный филиал) ===
  let revenue = 0
  const revenueByDirection: Record<string, { name: string; revenue: number }> = {}
  for (const a of raw.attendances) {
    if (!inWindow(a.ymKey) || !match(a.branchId)) continue
    revenue += a.chargeAmount
    const d = revenueByDirection[a.directionId] || { name: a.directionName, revenue: 0 }
    d.revenue += a.chargeAmount
    revenueByDirection[a.directionId] = d
  }

  // === ЗП (начислено из посещений; в срезе — только выбранный филиал) ===
  let totalSalaryAccrued = 0
  for (const s of raw.salary) if (inWindow(s.ymKey) && match(s.branchId)) totalSalaryAccrued += s.amount

  // === Прочие доходы (в срезе — доля ∝ выручке филиала, как общий расход) ===
  const otherIncomeMap = new Map<string, { id: string; name: string; amount: number }>()
  for (const p of raw.otherIncome) {
    if (!inWindow(p.ymKey)) continue
    let attributed = p.amount
    if (branchFilter) {
      attributed = 0
      distribute(p.amount, allRevenueCells(cellRevenue), (b, _d, part) => {
        if (match(b)) attributed += part
      })
    }
    if (attributed === 0) continue
    const prev = otherIncomeMap.get(p.categoryId) || { id: p.categoryId, name: p.categoryName, amount: 0 }
    prev.amount += attributed
    otherIncomeMap.set(p.categoryId, prev)
  }
  const otherIncomeByCategory = Array.from(otherIncomeMap.values()).sort((a, b) => b.amount - a.amount)
  const totalOtherIncome = otherIncomeByCategory.reduce((s, x) => s + x.amount, 0)

  // === Расходы: доля в окне признания + аллокация на филиал/направления ===
  interface Slice {
    categoryId: string
    categoryName: string
    isSalary: boolean
    isVariable: boolean
    /** Сумма, отнесённая к текущему срезу (или полная в общем виде). */
    amount: number
    /** Есть ли прямая привязка к направлению (для бейджа «прямой»). */
    isDirect: boolean
    /** directionId → сумма внутри среза (для таблицы «по направлениям»). */
    byDirection: Map<string, number>
  }
  const expenseSlices: Slice[] = []
  for (const e of raw.expenses) {
    const windowed = expenseAmountInWindow(e, fY, fM, tY, tM)
    if (windowed <= 0) continue
    const targets = resolveTargets(e.links, cellRevenue)
    const byDirection = new Map<string, number>()
    let amount = 0
    // В общем виде сумма категории = полная доля в окне (без потери точности на
    // округлениях распределения); раскладка по направлениям всё равно нужна для
    // таблицы «по направлениям». В срезе — только доли ячеек своего филиала.
    if (branchFilter) {
      distribute(windowed, targets, (b, d, part) => {
        if (!match(b)) return
        amount += part
        byDirection.set(d, (byDirection.get(d) ?? 0) + part)
      })
      if (amount === 0) continue
    } else {
      amount = windowed
      distribute(windowed, targets, (_b, d, part) => {
        byDirection.set(d, (byDirection.get(d) ?? 0) + part)
      })
    }
    expenseSlices.push({
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      isSalary: e.isSalary,
      isVariable: e.isVariable,
      amount,
      isDirect: e.links.some((l) => l.directionId),
      byDirection,
    })
  }

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
  // Прямые (привязка к направлению) → отдельным списком с бейджем; остальные —
  // распределённые ∝ выручке. Обе величины уже посчитаны в byDirection аллокацией.
  const fixedSlices = expenseSlices.filter((s) => !s.isVariable)
  const directFixedByDirection: Record<string, { items: { category: string; amount: number }[]; total: number }> = {}
  const distributionByDirCat: Record<string, Map<string, number>> = {}
  for (const s of fixedSlices) {
    for (const [dirId, amt] of s.byDirection) {
      if (amt === 0) continue
      if (s.isDirect) {
        const g = (directFixedByDirection[dirId] ??= { items: [], total: 0 })
        g.items.push({ category: s.categoryName, amount: amt })
        g.total += amt
      } else {
        const m = (distributionByDirCat[dirId] ??= new Map())
        m.set(s.categoryName, (m.get(s.categoryName) ?? 0) + amt)
      }
    }
  }

  const distributionByKey: Record<string, { category: string; distributedAmount: number }[]> = {}
  const distributedTotalByDir: Record<string, number> = {}
  for (const [dirId, catMap] of Object.entries(distributionByDirCat)) {
    distributionByKey[dirId] = Array.from(catMap, ([category, distributedAmount]) => ({ category, distributedAmount }))
    distributedTotalByDir[dirId] = Array.from(catMap.values()).reduce((s, x) => s + x, 0)
  }

  const dirName = (dirId: string): string =>
    revenueByDirection[dirId]?.name
    ?? raw.directionNameById.get(dirId)
    ?? (dirId === NO_DIRECTION_ID ? "Без направления" : dirId)

  const directionIdSet = new Set<string>([
    ...Object.keys(revenueByDirection),
    ...Object.keys(directFixedByDirection),
    ...Object.keys(distributionByDirCat),
  ])
  const directionEntries: PnlDirectionEntry[] = Array.from(directionIdSet)
    .map((dirId) => {
      const dirRevenue = revenueByDirection[dirId]?.revenue ?? 0
      const distributedFixedShare = distributedTotalByDir[dirId] ?? 0
      const directFixed = directFixedByDirection[dirId]?.total ?? 0
      return {
        directionId: dirId,
        name: dirName(dirId),
        revenue: dirRevenue,
        revenueShare: pct(dirRevenue, revenue),
        distributedFixed: distributedFixedShare + directFixed,
        directFixedItems: directFixedByDirection[dirId]?.items ?? [],
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
    .map((a) => ({ ...a, percentOfRevenue: pct(a.amount, revenue) }))

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
    distributionByKey,
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
