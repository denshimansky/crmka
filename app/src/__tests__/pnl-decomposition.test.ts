/**
 * Тесты «Финрез Декомпозиции» (lib/pnl-decomposition). Логика чистая, БД не нужна.
 * Ключевые инварианты:
 *  - Σ Доход дерева = выручка + прочие доходы; Σ Расход = расходы + ЗП; Σ Прибыль = netProfit.
 *  - Сумма помесячных деревьев = дерево за весь период (аддитивность).
 *  - Аллокация: прямой расход целиком в направление; общий — ∝ выручке.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computePnlDecomposition,
  type PnlDecompRawData,
  type DecompExpenseLink,
  type DecompExpenseRow,
  type DecompView,
  type DecompBranchNode,
  type DecompDirectionNode,
} from "@/lib/pnl-decomposition"

function ymKey(y: number, m: number): number {
  return y * 12 + (m - 1)
}

function exp(o: {
  amount: number
  date: string
  category: string
  links: DecompExpenseLink[]
  recognitionMode?: DecompExpenseRow["recognitionMode"]
  start?: string | null
  months?: number | null
}): DecompExpenseRow {
  return {
    amount: o.amount,
    date: new Date(`${o.date}T00:00:00.000Z`),
    recognitionMode: o.recognitionMode ?? "by_payment_date",
    amortizationMonths: o.months ?? null,
    amortizationStartDate: o.start ? new Date(`${o.start}T00:00:00.000Z`) : null,
    categoryName: o.category,
    links: o.links,
  }
}

const RAW: PnlDecompRawData = {
  branchNameById: new Map([
    ["b1", "Филиал A"],
    ["b2", "Филиал B"],
  ]),
  directionNameById: new Map([
    ["d1", "Английский"],
    ["d2", "Математика"],
  ]),
  revenue: [
    { branchId: "b1", directionId: "d1", amount: 1000, ymKey: ymKey(2026, 6) },
    { branchId: "b1", directionId: "d2", amount: 500, ymKey: ymKey(2026, 6) },
    { branchId: "b2", directionId: "d1", amount: 1500, ymKey: ymKey(2026, 7) },
  ],
  salary: [
    { branchId: "b1", directionId: "d1", amount: 200, ymKey: ymKey(2026, 6) },
    { branchId: "b2", directionId: "d1", amount: 300, ymKey: ymKey(2026, 7) },
  ],
  otherIncome: [{ categoryName: "Проценты банка", amount: 120, ymKey: ymKey(2026, 6) }],
  expenses: [
    // общий (без привязки) — распределяется ∝ выручке ячеек окна
    exp({ amount: 600, date: "2026-06-10", category: "Аренда", links: [] }),
    // привязан к филиалу b1 без направления — распределить внутри b1 ∝ выручке (d1:1000, d2:500)
    exp({ amount: 300, date: "2026-06-10", category: "Реклама", links: [{ branchId: "b1", directionId: null }] }),
    // прямой к b1/d2
    exp({ amount: 150, date: "2026-06-10", category: "Материалы", links: [{ branchId: "b1", directionId: "d2" }] }),
    // прямой к b2/d1 (июль)
    exp({ amount: 100, date: "2026-07-05", category: "Налоги", links: [{ branchId: "b2", directionId: "d1" }] }),
  ],
}

const branch = (v: DecompView, id: string): DecompBranchNode | undefined => v.branches.find((b) => b.branchId === id)
const dir = (b: DecompBranchNode, id: string): DecompDirectionNode | undefined => b.directions.find((d) => d.directionId === id)
const statya = (d: DecompDirectionNode, name: string): number => d.statyi.find((s) => s.name === name)?.expense ?? 0
const incomeStatya = (d: DecompDirectionNode, name: string): number => d.statyi.find((s) => s.name === name)?.income ?? 0

describe("computePnlDecomposition", () => {
  it("Июнь: totals reconcile с ручным расчётом", () => {
    const v = computePnlDecomposition(ymKey(2026, 6), ymKey(2026, 6), RAW)
    // Доход = выручка 1500 + прочие 120 = 1620
    assert.equal(v.totals.income, 1620)
    // Расход = ЗП 200 + Аренда 600 + Реклама 300 + Материалы 150 = 1250
    assert.equal(v.totals.expense, 1250)
    assert.equal(v.totals.profit, 370)
    // В июне только Филиал A (у b2 выручка/расходы в июле)
    assert.equal(v.branches.length, 1)
    assert.equal(v.branches[0].branchId, "b1")
  })

  it("Июнь: общий расход и филиальный распределяются ∝ выручке", () => {
    const v = computePnlDecomposition(ymKey(2026, 6), ymKey(2026, 6), RAW)
    const b1 = branch(v, "b1")!
    const d1 = dir(b1, "d1")!
    const d2 = dir(b1, "d2")!
    // Аренда 600: d1=600*1000/1500=400, d2=200
    assert.equal(statya(d1, "Аренда"), 400)
    assert.equal(statya(d2, "Аренда"), 200)
    // Реклама 300 внутри b1: d1=200, d2=100
    assert.equal(statya(d1, "Реклама"), 200)
    assert.equal(statya(d2, "Реклама"), 100)
    // Материалы 150 — прямой в d2, в d1 нет
    assert.equal(statya(d2, "Материалы"), 150)
    assert.equal(statya(d1, "Материалы"), 0)
    // Прочий доход 120 ∝ выручке: d1=80, d2=40
    assert.equal(incomeStatya(d1, "Проценты банка"), 80)
    assert.equal(incomeStatya(d2, "Проценты банка"), 40)
    // ЗП инструкторов — прямой в d1
    assert.equal(statya(d1, "ЗП инструкторов"), 200)
  })

  it("Июнь: агрегаты направления и филиала = сумме статей", () => {
    const v = computePnlDecomposition(ymKey(2026, 6), ymKey(2026, 6), RAW)
    const b1 = branch(v, "b1")!
    const d1 = dir(b1, "d1")!
    // d1: доход 1000+80=1080; расход 200+400+200=800; прибыль 280
    assert.equal(d1.income, 1080)
    assert.equal(d1.expense, 800)
    assert.equal(d1.profit, 280)
    // филиал = сумма направлений
    assert.equal(b1.income, 1620)
    assert.equal(b1.expense, 1250)
    assert.equal(b1.profit, 370)
  })

  it("ИНВАРИАНТ: сумма помесячных деревьев == дерево за весь период", () => {
    const period = computePnlDecomposition(ymKey(2026, 6), ymKey(2026, 7), RAW)
    const jun = computePnlDecomposition(ymKey(2026, 6), ymKey(2026, 6), RAW)
    const jul = computePnlDecomposition(ymKey(2026, 7), ymKey(2026, 7), RAW)

    assert.equal(jun.totals.income + jul.totals.income, period.totals.income)
    assert.equal(jun.totals.expense + jul.totals.expense, period.totals.expense)
    assert.equal(jun.totals.profit + jul.totals.profit, period.totals.profit)

    // Период: доход 3000+120=3120; расход 1150+ЗП500=1650; прибыль 1470
    assert.equal(period.totals.income, 3120)
    assert.equal(period.totals.expense, 1650)
    assert.equal(period.totals.profit, 1470)
    // За весь период — оба филиала
    assert.equal(period.branches.length, 2)
  })

  it("Расход, признанный в другом месяце (single_period), попадает в нужное окно", () => {
    const raw: PnlDecompRawData = {
      ...RAW,
      expenses: [
        // оплачен в августе, признан в июле
        exp({ amount: 900, date: "2026-08-28", category: "Взносы", links: [], recognitionMode: "single_period", start: "2026-07-01", months: 1 }),
      ],
      otherIncome: [],
    }
    const jul = computePnlDecomposition(ymKey(2026, 7), ymKey(2026, 7), raw)
    const aug = computePnlDecomposition(ymKey(2026, 8), ymKey(2026, 8), raw)
    // В июле выручка только у b2/d1 → весь общий расход туда
    assert.equal(jul.totals.expense, 900 + 300 /* ЗП b2 */)
    assert.equal(aug.totals.expense, 0)
  })
})
