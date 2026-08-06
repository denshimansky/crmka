// «Финрез Декомпозиция» — разложение финансового результата по дереву
// Филиал → Направление → Статья (аналог ОПИУ по структурным единицам в 1С).
//
// Чистая функция без БД: страница один раз вытягивает сырые строки за весь период,
// затем считает дерево за весь период И за каждый месяц одним и тем же кодом.
//
// Методология аллокации (согласована с владельцем):
//  - Выручка и ЗП инструкторов привязаны к (филиал, направление) напрямую (через занятие).
//  - Каждый расход раскладывается на ячейки (филиал, направление) ПРОПОРЦИОНАЛЬНО выручке:
//      • расход с прямой привязкой к направлению → целиком в эту ячейку;
//      • привязка только к филиалу → распределяется внутри филиала ∝ выручке направлений;
//      • без привязки (общий) → распределяется по всей сети ∝ выручке ячеек.
//  - Прочие доходы (без филиала) распределяются как общий расход — по всей сети ∝ выручке.
//
// Инвариант (покрыт тестом): суммарные Доход/Расход/Прибыль дерева совпадают с основным
// P&L за то же окно (totalIncome / totalExpenses+ЗП / netProfit), а сумма помесячных
// деревьев равна дереву за весь период для аддитивных величин.

import { expenseAmountInWindow, type ExpenseLike } from "./expense-amortization"

export const NO_BRANCH_ID = "__no_branch__"
export const NO_DIRECTION_ID = "__no_direction__"
export const NO_BRANCH_LABEL = "Без филиала"
export const NO_DIRECTION_LABEL = "Без направления"
export const REVENUE_STATYA = "Выручка от продаж"
export const INSTRUCTOR_SALARY_STATYA = "ЗП инструкторов"

export interface DecompRevenueRow {
  branchId: string
  directionId: string
  amount: number
  ymKey: number
}
export interface DecompSalaryRow {
  branchId: string
  directionId: string
  amount: number
  ymKey: number
}
export interface DecompOtherIncomeRow {
  categoryName: string
  amount: number
  ymKey: number
}
export interface DecompExpenseLink {
  branchId: string | null
  directionId: string | null
}
export interface DecompExpenseRow extends ExpenseLike {
  categoryName: string
  links: DecompExpenseLink[]
}

export interface PnlDecompRawData {
  revenue: DecompRevenueRow[]
  salary: DecompSalaryRow[]
  otherIncome: DecompOtherIncomeRow[]
  expenses: DecompExpenseRow[]
  branchNameById: Map<string, string>
  directionNameById: Map<string, string>
}

export interface DecompStatya {
  name: string
  income: number
  expense: number
}
export interface DecompDirectionNode {
  /** Уникальный id узла для состояния сворачивания: `${branchId}::${directionId}`. */
  id: string
  directionId: string
  name: string
  income: number
  expense: number
  profit: number
  statyi: DecompStatya[]
}
export interface DecompBranchNode {
  id: string
  branchId: string
  name: string
  income: number
  expense: number
  profit: number
  directions: DecompDirectionNode[]
}
export interface DecompView {
  branches: DecompBranchNode[]
  totals: { income: number; expense: number; profit: number }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function keyToYm(key: number): [number, number] {
  return [Math.floor(key / 12), (key % 12) + 1]
}

interface Cell {
  income: Map<string, number>
  expense: Map<string, number>
}
interface Target {
  b: string
  d: string
  weight: number
}

/** Считает дерево декомпозиции за окно [fromKey..toKey] (включительно). */
export function computePnlDecomposition(
  fromKey: number,
  toKey: number,
  raw: PnlDecompRawData,
): DecompView {
  const inWindow = (k: number) => k >= fromKey && k <= toKey
  const [fY, fM] = keyToYm(fromKey)
  const [tY, tM] = keyToYm(toKey)

  // Ячейки дерева: branchId → directionId → { доходы по статьям, расходы по статьям }.
  const cells = new Map<string, Map<string, Cell>>()
  const ensureCell = (b: string, d: string): Cell => {
    let byDir = cells.get(b)
    if (!byDir) {
      byDir = new Map()
      cells.set(b, byDir)
    }
    let cell = byDir.get(d)
    if (!cell) {
      cell = { income: new Map(), expense: new Map() }
      byDir.set(d, cell)
    }
    return cell
  }
  const addIncome = (b: string, d: string, statya: string, amt: number) => {
    const c = ensureCell(b, d)
    c.income.set(statya, (c.income.get(statya) ?? 0) + amt)
  }
  const addExpense = (b: string, d: string, statya: string, amt: number) => {
    const c = ensureCell(b, d)
    c.expense.set(statya, (c.expense.get(statya) ?? 0) + amt)
  }

  // Веса распределения = выручка ячейки (только выручка, не ЗП/прочие доходы).
  const cellRevenue = new Map<string, Map<string, number>>()
  const bumpRevenue = (b: string, d: string, amt: number) => {
    let byDir = cellRevenue.get(b)
    if (!byDir) {
      byDir = new Map()
      cellRevenue.set(b, byDir)
    }
    byDir.set(d, (byDir.get(d) ?? 0) + amt)
  }

  // Pass 1: выручка (напрямую в ячейку + вес распределения).
  for (const r of raw.revenue) {
    if (!inWindow(r.ymKey) || r.amount === 0) continue
    addIncome(r.branchId, r.directionId, REVENUE_STATYA, r.amount)
    bumpRevenue(r.branchId, r.directionId, r.amount)
  }

  // Pass 2: ЗП инструкторов (прямой расход ячейки).
  for (const s of raw.salary) {
    if (!inWindow(s.ymKey) || s.amount === 0) continue
    addExpense(s.branchId, s.directionId, INSTRUCTOR_SALARY_STATYA, s.amount)
  }

  // Все выручковые ячейки как цели распределения (общий расход / прочий доход).
  const allRevenueCells = (): Target[] => {
    const out: Target[] = []
    for (const [b, byDir] of cellRevenue) for (const [d, rev] of byDir) out.push({ b, d, weight: rev })
    return out
  }
  const branchRevenueCells = (b: string): Target[] => {
    const byDir = cellRevenue.get(b)
    return byDir ? Array.from(byDir, ([d, rev]) => ({ b, d, weight: rev })) : []
  }
  const directionCells = (d: string): Target[] => {
    const out: Target[] = []
    for (const [b, byDir] of cellRevenue) {
      const rev = byDir.get(d)
      if (rev != null) out.push({ b, d, weight: rev })
    }
    return out
  }

  // Приводит связи расхода к списку целевых ячеек с весами (выручка).
  const resolveTargets = (links: DecompExpenseLink[]): Target[] => {
    const meaningful = links.filter((l) => l.branchId || l.directionId)
    if (meaningful.length === 0) return allRevenueCells()

    const merged = new Map<string, Target>()
    const push = (b: string, d: string, weight: number) => {
      const key = `${b}::${d}`
      const prev = merged.get(key)
      if (prev) prev.weight += weight
      else merged.set(key, { b, d, weight })
    }
    for (const l of meaningful) {
      if (l.branchId && l.directionId) {
        push(l.branchId, l.directionId, cellRevenue.get(l.branchId)?.get(l.directionId) ?? 0)
      } else if (l.branchId) {
        const scoped = branchRevenueCells(l.branchId)
        if (scoped.length) for (const c of scoped) push(c.b, c.d, c.weight)
        else push(l.branchId, NO_DIRECTION_ID, 0)
      } else if (l.directionId) {
        const scoped = directionCells(l.directionId)
        if (scoped.length) for (const c of scoped) push(c.b, c.d, c.weight)
        else push(NO_BRANCH_ID, l.directionId, 0)
      }
    }
    return Array.from(merged.values())
  }

  // Раскладывает сумму по целям ∝ весам (при нулевых весах — поровну), с компенсацией
  // округления в последней цели, чтобы Σ долей точно равнялась исходной сумме.
  const distribute = (amount: number, targets: Target[], apply: (b: string, d: string, part: number) => void) => {
    if (targets.length === 0) {
      apply(NO_BRANCH_ID, NO_DIRECTION_ID, amount)
      return
    }
    const totalW = targets.reduce((s, t) => s + Math.max(0, t.weight), 0)
    let distributed = 0
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      let part: number
      if (i === targets.length - 1) {
        part = round2(amount - distributed)
      } else {
        const share = totalW > 0 ? Math.max(0, t.weight) / totalW : 1 / targets.length
        part = round2(amount * share)
        distributed = round2(distributed + part)
      }
      if (part !== 0) apply(t.b, t.d, part)
    }
  }

  // Pass 3: расходы (доля в окне признания → раскладка по ячейкам).
  for (const e of raw.expenses) {
    const amt = expenseAmountInWindow(e, fY, fM, tY, tM)
    if (amt <= 0) continue
    distribute(amt, resolveTargets(e.links), (b, d, part) => addExpense(b, d, e.categoryName, part))
  }

  // Pass 4: прочие доходы — распределяем по сети ∝ выручке (как общий расход).
  for (const oi of raw.otherIncome) {
    if (!inWindow(oi.ymKey) || oi.amount === 0) continue
    distribute(oi.amount, allRevenueCells(), (b, d, part) => addIncome(b, d, oi.categoryName, part))
  }

  // === Сборка дерева ===
  const resolveBranchName = (b: string) => (b === NO_BRANCH_ID ? NO_BRANCH_LABEL : raw.branchNameById.get(b) ?? b)
  const resolveDirName = (d: string) => (d === NO_DIRECTION_ID ? NO_DIRECTION_LABEL : raw.directionNameById.get(d) ?? d)

  const branches: DecompBranchNode[] = []
  for (const [b, byDir] of cells) {
    const directions: DecompDirectionNode[] = []
    for (const [d, cell] of byDir) {
      const incomeStatyi: DecompStatya[] = Array.from(cell.income, ([name, val]) => ({ name, income: round2(val), expense: 0 }))
      const expenseStatyi: DecompStatya[] = Array.from(cell.expense, ([name, val]) => ({ name, income: 0, expense: round2(val) }))
      // Доход: «Выручка от продаж» первой, затем прочие по убыванию; расходы по убыванию.
      incomeStatyi.sort((a, z) => (a.name === REVENUE_STATYA ? -1 : z.name === REVENUE_STATYA ? 1 : z.income - a.income))
      expenseStatyi.sort((a, z) => z.expense - a.expense)
      const income = round2(incomeStatyi.reduce((s, x) => s + x.income, 0))
      const expense = round2(expenseStatyi.reduce((s, x) => s + x.expense, 0))
      directions.push({
        id: `${b}::${d}`,
        directionId: d,
        name: resolveDirName(d),
        income,
        expense,
        profit: round2(income - expense),
        statyi: [...incomeStatyi, ...expenseStatyi],
      })
    }
    // Направления по убыванию дохода; «Без направления» — в конец.
    directions.sort((a, z) => (a.directionId === NO_DIRECTION_ID ? 1 : z.directionId === NO_DIRECTION_ID ? -1 : z.income - a.income))
    const income = round2(directions.reduce((s, x) => s + x.income, 0))
    const expense = round2(directions.reduce((s, x) => s + x.expense, 0))
    branches.push({
      id: b,
      branchId: b,
      name: resolveBranchName(b),
      income,
      expense,
      profit: round2(income - expense),
      directions,
    })
  }
  // Филиалы по убыванию дохода; «Без филиала» — в конец.
  branches.sort((a, z) => (a.branchId === NO_BRANCH_ID ? 1 : z.branchId === NO_BRANCH_ID ? -1 : z.income - a.income))

  const totalIncome = round2(branches.reduce((s, x) => s + x.income, 0))
  const totalExpense = round2(branches.reduce((s, x) => s + x.expense, 0))
  return {
    branches,
    totals: { income: totalIncome, expense: totalExpense, profit: round2(totalIncome - totalExpense) },
  }
}
