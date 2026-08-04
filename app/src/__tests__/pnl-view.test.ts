/**
 * Тесты числовой агрегации P&L (lib/pnl-view). Логика чистая, БД не нужна.
 * Ключевой инвариант: сумма помесячных видов == вид за весь период для аддитивных
 * величин (выручка, расходы, ЗП, прочие доходы) — гарантия корректной декомпозиции.
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

function ymKey(y: number, m: number): number {
  return monthKey(y, m)
}

function expenseRow(o: {
  amount: number; date: string; categoryId: string; categoryName: string
  recognitionMode?: PnlExpenseRow["recognitionMode"]; start?: string | null; months?: number | null
  isVariable?: boolean; isSalary?: boolean; directDirectionId?: string | null
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
    directDirectionId: o.directDirectionId ?? null,
  }
}

const RAW: PnlRawData = {
  attendances: [
    { chargeAmount: 1000, ymKey: ymKey(2026, 6), directionId: "d1", directionName: "Танцы" },
    { chargeAmount: 2000, ymKey: ymKey(2026, 7), directionId: "d1", directionName: "Танцы" },
    { chargeAmount: 500, ymKey: ymKey(2026, 7), directionId: "d2", directionName: "Рисование" },
    { chargeAmount: 800, ymKey: ymKey(2026, 8), directionId: "d2", directionName: "Рисование" },
  ],
  salary: [
    { amount: 300, ymKey: ymKey(2026, 6) },
    { amount: 400, ymKey: ymKey(2026, 7) },
    { amount: 100, ymKey: ymKey(2026, 8) },
  ],
  otherIncome: [
    { amount: 250, ymKey: ymKey(2026, 7), categoryId: "i1", categoryName: "Мерч" },
  ],
  expenses: [
    // аренда: оплачена помесячно
    expenseRow({ amount: 600, date: "2026-06-05", categoryId: "c1", categoryName: "Аренда" }),
    expenseRow({ amount: 600, date: "2026-07-05", categoryId: "c1", categoryName: "Аренда" }),
    // взносы за июль оплачены в августе (признание раньше платежа) — амортизация 1 мес в июле
    expenseRow({ amount: 900, date: "2026-08-28", categoryId: "c2", categoryName: "Налоги", recognitionMode: "single_period", start: "2026-07-01", months: 1 }),
    // переменный расход, привязан к направлению d1
    expenseRow({ amount: 200, date: "2026-07-10", categoryId: "c3", categoryName: "Материалы", isVariable: true, directDirectionId: "d1" }),
  ],
  directionNameById: new Map([["d1", "Танцы"], ["d2", "Рисование"]]),
}

describe("computePnlView", () => {
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
