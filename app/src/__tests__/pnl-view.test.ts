/**
 * Тесты числовой агрегации P&L (lib/pnl-view). Логика чистая, БД не нужна.
 * Инварианты:
 *  - сумма помесячных видов == вид за весь период (аддитивные величины);
 *  - Σ срезов филиалов == общий вид (расходы/выручка/ЗП/прочие доходы/прибыль);
 *  - общий расход делится ∝ выручке филиалов, мультифилиальный не задваивается.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computePnlView,
  enumerateMonths,
  monthKey,
  monthKeyOfDate,
  type PnlRawData,
  type PnlExpenseRow,
} from "@/lib/pnl-view"
import type { AllocLink } from "@/lib/pnl-allocation"

function ymKey(y: number, m: number): number {
  return monthKey(y, m)
}

function expenseRow(o: {
  amount: number; date: string; categoryId: string; categoryName: string
  recognitionMode?: PnlExpenseRow["recognitionMode"]; start?: string | null; months?: number | null
  isVariable?: boolean; isSalary?: boolean; links?: AllocLink[]
}): PnlExpenseRow {
  return {
    amount: o.amount,
    date: new Date(`${o.date}T00:00:00.000Z`),
    recognitionMode: o.recognitionMode ?? "by_payment_date",
    amortizationMonths: o.months ?? null,
    amortizationStartDate: o.start ? new Date(`${o.start}T00:00:00.000Z`) : null,
    categoryId: o.categoryId,
    categoryName: o.categoryName,
    isSalary: o.isSalary ?? false,
    isVariable: o.isVariable ?? false,
    links: o.links ?? [],
  }
}

// Сеть из двух филиалов: b1 (Танцы), b2 (Рисование).
const RAW: PnlRawData = {
  attendances: [
    { chargeAmount: 1000, ymKey: ymKey(2026, 6), branchId: "b1", directionId: "d1", directionName: "Танцы" },
    { chargeAmount: 2000, ymKey: ymKey(2026, 7), branchId: "b1", directionId: "d1", directionName: "Танцы" },
    { chargeAmount: 500, ymKey: ymKey(2026, 7), branchId: "b2", directionId: "d2", directionName: "Рисование" },
    { chargeAmount: 800, ymKey: ymKey(2026, 8), branchId: "b2", directionId: "d2", directionName: "Рисование" },
  ],
  salary: [
    { amount: 300, ymKey: ymKey(2026, 6), branchId: "b1" },
    { amount: 400, ymKey: ymKey(2026, 7), branchId: "b1" },
    { amount: 100, ymKey: ymKey(2026, 8), branchId: "b2" },
  ],
  otherIncome: [
    { amount: 250, ymKey: ymKey(2026, 7), categoryId: "i1", categoryName: "Мерч" },
  ],
  expenses: [
    // аренда: оплачена помесячно, общий расход (без привязки)
    expenseRow({ amount: 600, date: "2026-06-05", categoryId: "c1", categoryName: "Аренда" }),
    expenseRow({ amount: 600, date: "2026-07-05", categoryId: "c1", categoryName: "Аренда" }),
    // взносы за июль оплачены в августе (признание раньше платежа) — амортизация 1 мес в июле; общий
    expenseRow({ amount: 900, date: "2026-08-28", categoryId: "c2", categoryName: "Налоги", recognitionMode: "single_period", start: "2026-07-01", months: 1 }),
    // переменный расход, привязан к направлению d1 (без филиала → все филиалы с d1)
    expenseRow({ amount: 200, date: "2026-07-10", categoryId: "c3", categoryName: "Материалы", isVariable: true, links: [{ branchId: null, directionId: "d1" }] }),
  ],
  directionNameById: new Map([["d1", "Танцы"], ["d2", "Рисование"]]),
}

describe("computePnlView (общий вид)", () => {
  it("считает выручку/расходы/ЗП/доходы за окно", () => {
    const v = computePnlView(ymKey(2026, 7), ymKey(2026, 7), RAW)
    assert.equal(v.revenue, 2500) // 2000 + 500
    assert.equal(v.totalSalaryAccrued, 400)
    assert.equal(v.totalOtherIncome, 250)
    // расходы июля: аренда 600 + налоги 900 (признаны в июле) + материалы 200 = 1700
    assert.equal(v.totalExpenses, 1700)
    assert.equal(v.variableExpenses, 200)
    assert.equal(v.fixedExpenses, 1500)
  })

  it("взносы, оплаченные в августе, признаются в июле (не в августе)", () => {
    const jul = computePnlView(ymKey(2026, 7), ymKey(2026, 7), RAW)
    const aug = computePnlView(ymKey(2026, 8), ymKey(2026, 8), RAW)
    const julTaxes = jul.expenseCategories.find((c) => c.name === "Налоги")?.amount ?? 0
    const augTaxes = aug.expenseCategories.find((c) => c.name === "Налоги")?.amount ?? 0
    assert.equal(julTaxes, 900)
    assert.equal(augTaxes, 0)
  })

  it("ИНВАРИАНТ: сумма помесячных видов == вид за весь период (аддитивные)", () => {
    const fromY = 2026, fromM = 6, toY = 2026, toM = 8
    const total = computePnlView(ymKey(fromY, fromM), ymKey(toY, toM), RAW)
    const months = enumerateMonths(fromY, fromM, toY, toM)
    const per = months.map((mm) => computePnlView(mm.key, mm.key, RAW))

    const sum = (pick: (v: typeof total) => number) => per.reduce((s, v) => s + pick(v), 0)
    const approx = (a: number, b: number, msg: string) =>
      assert.ok(Math.abs(a - b) < 0.01, `${msg}: сумма месяцев ${a} != всего ${b}`)

    approx(sum((v) => v.revenue), total.revenue, "revenue")
    approx(sum((v) => v.totalExpenses), total.totalExpenses, "totalExpenses")
    approx(sum((v) => v.totalSalaryAccrued), total.totalSalaryAccrued, "salary")
    approx(sum((v) => v.totalOtherIncome), total.totalOtherIncome, "otherIncome")
    approx(sum((v) => v.variableExpenses), total.variableExpenses, "variableExpenses")
    approx(sum((v) => v.fixedExpenses), total.fixedExpenses, "fixedExpenses")
    // netProfit тоже аддитивен (все слагаемые аддитивны)
    approx(sum((v) => v.netProfit), total.netProfit, "netProfit")
  })

  it("enumerateMonths перечисляет месяцы включительно и через границу года", () => {
    const ms = enumerateMonths(2026, 11, 2027, 2)
    assert.deepEqual(ms.map((m) => `${m.year}-${m.month}`), ["2026-11", "2026-12", "2027-1", "2027-2"])
  })

  it("monthKeyOfDate берёт UTC-месяц", () => {
    assert.equal(monthKeyOfDate(new Date("2026-07-15T00:00:00.000Z")), monthKey(2026, 7))
  })
})

describe("computePnlView (срезы филиалов)", () => {
  // Июль: выручка b1/d1=2000, b2/d2=500 (сеть 2500). Веса аллокации.
  const jul = ymKey(2026, 7)

  it("ИНВАРИАНТ: Σ срезов филиалов == общий вид (июль)", () => {
    const all = computePnlView(jul, jul, RAW)
    const b1 = computePnlView(jul, jul, RAW, "b1")
    const b2 = computePnlView(jul, jul, RAW, "b2")
    const approx = (a: number, b: number, msg: string) =>
      assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} != ${b}`)
    approx(b1.revenue + b2.revenue, all.revenue, "revenue")
    approx(b1.totalExpenses + b2.totalExpenses, all.totalExpenses, "totalExpenses")
    approx(b1.totalSalaryAccrued + b2.totalSalaryAccrued, all.totalSalaryAccrued, "salary")
    approx(b1.totalOtherIncome + b2.totalOtherIncome, all.totalOtherIncome, "otherIncome")
    approx(b1.netProfit + b2.netProfit, all.netProfit, "netProfit")
  })

  it("общий расход делится ∝ выручке филиалов (Аренда 600: b1=480, b2=120)", () => {
    const b1 = computePnlView(jul, jul, RAW, "b1")
    const b2 = computePnlView(jul, jul, RAW, "b2")
    assert.equal(b1.expenseCategories.find((c) => c.name === "Аренда")?.amount, 480)
    assert.equal(b2.expenseCategories.find((c) => c.name === "Аренда")?.amount, 120)
    // Налоги 900: b1=720, b2=180
    assert.equal(b1.expenseCategories.find((c) => c.name === "Налоги")?.amount, 720)
    assert.equal(b2.expenseCategories.find((c) => c.name === "Налоги")?.amount, 180)
  })

  it("расход, привязанный к направлению d1, целиком в филиале с этим направлением", () => {
    const b1 = computePnlView(jul, jul, RAW, "b1")
    const b2 = computePnlView(jul, jul, RAW, "b2")
    // Материалы (d1) есть только в b1
    assert.equal(b1.expenseCategories.find((c) => c.name === "Материалы")?.amount, 200)
    assert.equal(b2.expenseCategories.find((c) => c.name === "Материалы"), undefined)
  })

  it("выручка/ЗП/прочие доходы среза — только свой филиал (ЗП в b1, доход ∝ выручке)", () => {
    const b1 = computePnlView(jul, jul, RAW, "b1")
    const b2 = computePnlView(jul, jul, RAW, "b2")
    assert.equal(b1.revenue, 2000)
    assert.equal(b2.revenue, 500)
    assert.equal(b1.totalSalaryAccrued, 400) // вся июльская ЗП в b1
    assert.equal(b2.totalSalaryAccrued, 0)
    // Прочий доход 250 ∝ выручке: b1=200, b2=50
    assert.equal(b1.totalOtherIncome, 200)
    assert.equal(b2.totalOtherIncome, 50)
  })

  it("мультифилиальный расход делится ∝ выручке выбранных филиалов, не задваивается", () => {
    // Расход 300 на оба филиала (b1, b2). Июль: b1=2000, b2=500 → b1=240, b2=60. Σ=300.
    const raw: PnlRawData = {
      ...RAW,
      expenses: [
        expenseRow({
          amount: 300, date: "2026-07-05", categoryId: "cX", categoryName: "Интернет",
          links: [{ branchId: "b1", directionId: null }, { branchId: "b2", directionId: null }],
        }),
      ],
      otherIncome: [],
    }
    const all = computePnlView(jul, jul, raw)
    const b1 = computePnlView(jul, jul, raw, "b1")
    const b2 = computePnlView(jul, jul, raw, "b2")
    assert.equal(all.totalExpenses, 300) // не задваивается в общем виде
    assert.equal(b1.expenseCategories.find((c) => c.name === "Интернет")?.amount, 240)
    assert.equal(b2.expenseCategories.find((c) => c.name === "Интернет")?.amount, 60)
    assert.ok(Math.abs(b1.totalExpenses + b2.totalExpenses - all.totalExpenses) < 0.01)
  })
})
