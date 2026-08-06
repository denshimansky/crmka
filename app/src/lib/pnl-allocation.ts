// Единое ядро аллокации ОПИУ (P&L): раскладка суммы расхода / прочего дохода по
// ячейкам (филиал, направление) ПРОПОРЦИОНАЛЬНО выручке ячеек.
//
// Извлечено из pnl-decomposition.ts, чтобы ОДНУ и ту же логику использовали и
// «Финрез Декомпозиция» (дерево филиал→направление→статья), и основной P&L
// (computePnlView, в т.ч. срезы по филиалам). Общий источник аллокации гарантирует,
// что суммы дерева и таблицы P&L сходятся (reconcile) по построению.
//
// Правила привязки расхода к ячейкам (resolveTargets):
//   • нет привязки (общий) → все выручковые ячейки сети ∝ их выручке;
//   • только филиал → ячейки этого филиала ∝ выручке его направлений;
//   • только направление → это направление во всех филиалах ∝ выручке ячеек;
//   • филиал + направление → ровно в эту ячейку.
// Несколько связей объединяются (веса складываются). distribute раскладывает сумму
// ∝ весам (при нулевых весах — поровну) с компенсацией округления в последней цели,
// поэтому Σ долей точно равна исходной сумме.

export const NO_BRANCH_ID = "__no_branch__"
export const NO_DIRECTION_ID = "__no_direction__"

/** Связь расхода с (филиал, направление); любое поле может быть null (не указано). */
export interface AllocLink {
  branchId: string | null
  directionId: string | null
}

/** Целевая ячейка аллокации с весом (= выручка ячейки). */
export interface Target {
  b: string
  d: string
  weight: number
}

/** branchId → directionId → выручка ячейки (веса распределения). */
export type CellRevenue = Map<string, Map<string, number>>

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Собирает карту весов-выручки по ячейкам (филиал, направление) из строк выручки. */
export function buildCellRevenue(
  rows: Iterable<{ branchId: string; directionId: string; amount: number }>,
): CellRevenue {
  const cellRevenue: CellRevenue = new Map()
  for (const r of rows) {
    if (r.amount === 0) continue
    let byDir = cellRevenue.get(r.branchId)
    if (!byDir) {
      byDir = new Map()
      cellRevenue.set(r.branchId, byDir)
    }
    byDir.set(r.directionId, (byDir.get(r.directionId) ?? 0) + r.amount)
  }
  return cellRevenue
}

// Детерминированный порядок целей: раскладка distribute отдаёт остаток округления
// последней цели, поэтому порядок влияет на per-cell доли. Сортировка по (филиал,
// направление) делает доли независимыми от порядка строк выручки в источнике — тогда
// основной P&L, «Финрез Декомпозиция» и drill-down дают одинаковые числа (reconcile).
function sortTargets(targets: Target[]): Target[] {
  return targets.sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : x.d < y.d ? -1 : x.d > y.d ? 1 : 0))
}

/** Все выручковые ячейки сети как цели (для общего расхода / прочего дохода). */
export function allRevenueCells(cellRevenue: CellRevenue): Target[] {
  const out: Target[] = []
  for (const [b, byDir] of cellRevenue) for (const [d, rev] of byDir) out.push({ b, d, weight: rev })
  return sortTargets(out)
}

function branchRevenueCells(cellRevenue: CellRevenue, b: string): Target[] {
  const byDir = cellRevenue.get(b)
  return byDir ? Array.from(byDir, ([d, rev]) => ({ b, d, weight: rev })) : []
}

function directionCells(cellRevenue: CellRevenue, d: string): Target[] {
  const out: Target[] = []
  for (const [b, byDir] of cellRevenue) {
    const rev = byDir.get(d)
    if (rev != null) out.push({ b, d, weight: rev })
  }
  return out
}

/** Приводит связи расхода к списку целевых ячеек с весами (выручка). */
export function resolveTargets(links: AllocLink[], cellRevenue: CellRevenue): Target[] {
  const meaningful = links.filter((l) => l.branchId || l.directionId)
  if (meaningful.length === 0) return allRevenueCells(cellRevenue)

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
      const scoped = branchRevenueCells(cellRevenue, l.branchId)
      if (scoped.length) for (const c of scoped) push(c.b, c.d, c.weight)
      else push(l.branchId, NO_DIRECTION_ID, 0)
    } else if (l.directionId) {
      const scoped = directionCells(cellRevenue, l.directionId)
      if (scoped.length) for (const c of scoped) push(c.b, c.d, c.weight)
      else push(NO_BRANCH_ID, l.directionId, 0)
    }
  }
  return sortTargets(Array.from(merged.values()))
}

/**
 * Раскладывает сумму по целям ∝ весам (при нулевых весах — поровну), с компенсацией
 * округления в последней цели, чтобы Σ долей точно равнялась исходной сумме.
 * Порядок целей детерминирован (порядок вставки в Map), поэтому раскладка одинакова
 * у всех потребителей ядра.
 */
export function distribute(
  amount: number,
  targets: Target[],
  apply: (b: string, d: string, part: number) => void,
): void {
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

/**
 * Доля суммы (расхода / прочего дохода), приходящаяся на филиал `branchId`: раскладывает
 * сумму по ячейкам ∝ выручке (resolveTargets + distribute) и суммирует части выбранного
 * филиала. `links=[]` → общий (по всей сети). Используется в срезах филиалов ОПИУ, чтобы
 * общие / оклад-твин / мультифилиальные расходы не выпадали и не задваивались.
 */
export function branchShare(
  amount: number,
  links: AllocLink[],
  cellRevenue: CellRevenue,
  branchId: string,
): number {
  let sum = 0
  distribute(amount, resolveTargets(links, cellRevenue), (b, _d, part) => {
    if (b === branchId) sum += part
  })
  return round2(sum)
}
