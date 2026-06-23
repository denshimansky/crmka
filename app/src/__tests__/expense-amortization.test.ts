/**
 * Unit-тесты раскладки расхода в ОПИУ. Логика чистая, БД не нужна.
 * Покрывает кейсы из плана: by_payment_date, single_period, amortized,
 * проверка инвариантов (сумма долей == amount, anti-rounding-drift).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  expandExpenseToMonths,
  expenseAmountInWindow,
  AMORTIZATION_LOOKBACK_MONTHS,
} from "@/lib/expense-amortization"

function expense(opts: {
  amount: number
  date: string // YYYY-MM-DD
  mode: "by_payment_date" | "single_period" | "amortized" | "not_in_pnl"
  months?: number | null
  start?: string | null
}) {
  return {
    amount: opts.amount,
    date: new Date(`${opts.date}T00:00:00.000Z`),
    recognitionMode: opts.mode,
    amortizationMonths: opts.months ?? null,
    amortizationStartDate: opts.start ? new Date(`${opts.start}T00:00:00.000Z`) : null,
  } as const
}

describe("expandExpenseToMonths", () => {
  describe("by_payment_date", () => {
    it("одна строка в месяц date", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 30000, date: "2026-06-25", mode: "by_payment_date",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 6, amount: 30000 }])
    })

    it("игнорирует amortization* поля если режим by_payment_date", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 30000, date: "2026-06-25", mode: "by_payment_date",
        months: 3, start: "2026-09-01",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 6, amount: 30000 }])
    })
  })

  describe("not_in_pnl (не учитывать в финрезе)", () => {
    it("возвращает пустой массив — расход не попадает в ОПИУ", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 50000, date: "2026-06-10", mode: "not_in_pnl",
      }))
      assert.deepEqual(slices, [])
    })

    it("expenseAmountInWindow всегда 0 для not_in_pnl", () => {
      const e = expense({ amount: 50000, date: "2026-06-10", mode: "not_in_pnl" })
      assert.equal(expenseAmountInWindow(e, 2026, 6, 2026, 6), 0)
      assert.equal(expenseAmountInWindow(e, 2026, 1, 2026, 12), 0)
    })
  })

  describe("single_period (К-3: аренда июня уплачена 25 мая)", () => {
    it("одна строка в месяц amortizationStartDate", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 30000, date: "2026-05-25", mode: "single_period",
        start: "2026-06-01",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 6, amount: 30000 }])
    })

    it("fallback на date если start не задан", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 1000, date: "2026-04-10", mode: "single_period",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 4, amount: 1000 }])
    })
  })

  describe("amortized (К-2: принтер 30 000 на 3 месяца)", () => {
    it("раскладывает на N месяцев начиная с start", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 30000, date: "2026-06-01", mode: "amortized",
        months: 3, start: "2026-06-01",
      }))
      assert.deepEqual(slices, [
        { year: 2026, month: 6, amount: 10000 },
        { year: 2026, month: 7, amount: 10000 },
        { year: 2026, month: 8, amount: 10000 },
      ])
    })

    it("anti-rounding-drift: остаток в последний месяц", () => {
      // 100 / 3 = 33.33 → последний месяц должен компенсировать
      const slices = expandExpenseToMonths(expense({
        amount: 100, date: "2026-06-01", mode: "amortized",
        months: 3, start: "2026-06-01",
      }))
      const total = slices.reduce((s, x) => s + x.amount, 0)
      assert.equal(Math.round(total * 100) / 100, 100, "сумма долей должна равняться amount")
      assert.equal(slices[0].amount, 33.33)
      assert.equal(slices[1].amount, 33.33)
      assert.equal(slices[2].amount, 33.34, "последний месяц должен получить остаток")
    })

    it("пересекает границу года", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 12000, date: "2026-11-15", mode: "amortized",
        months: 4, start: "2026-11-01",
      }))
      assert.deepEqual(slices.map(s => `${s.year}-${s.month}`), [
        "2026-11", "2026-12", "2027-1", "2027-2",
      ])
      const total = slices.reduce((s, x) => s + x.amount, 0)
      assert.equal(Math.round(total * 100) / 100, 12000)
    })

    it("N=1 ведёт себя как single_period", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 5000, date: "2026-05-25", mode: "amortized",
        months: 1, start: "2026-06-01",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 6, amount: 5000 }])
    })

    it("fallback на by_payment_date если months=0 или start не задан", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 5000, date: "2026-05-25", mode: "amortized",
        months: 0, start: "2026-06-01",
      }))
      assert.deepEqual(slices, [{ year: 2026, month: 5, amount: 5000 }])

      const slices2 = expandExpenseToMonths(expense({
        amount: 5000, date: "2026-05-25", mode: "amortized",
        months: 3, start: null,
      }))
      assert.deepEqual(slices2, [{ year: 2026, month: 5, amount: 5000 }])
    })
  })

  describe("инварианты", () => {
    it("сумма всегда равна amount (по всем режимам)", () => {
      const cases = [
        expense({ amount: 12345.67, date: "2026-04-10", mode: "by_payment_date" }),
        expense({ amount: 12345.67, date: "2026-04-10", mode: "single_period", start: "2026-09-01" }),
        expense({ amount: 12345.67, date: "2026-04-10", mode: "amortized", months: 7, start: "2026-05-01" }),
        expense({ amount: 999.99, date: "2026-04-10", mode: "amortized", months: 12, start: "2026-04-01" }),
      ]
      for (const e of cases) {
        const slices = expandExpenseToMonths(e)
        const total = slices.reduce((s, x) => s + x.amount, 0)
        assert.equal(Math.round(total * 100) / 100, Number(e.amount), `mode=${e.recognitionMode}`)
      }
    })

    it("всегда возвращает >= 1 элемент", () => {
      const slices = expandExpenseToMonths(expense({
        amount: 100, date: "2026-01-01", mode: "by_payment_date",
      }))
      assert.ok(slices.length >= 1)
    })
  })
})

describe("expenseAmountInWindow", () => {
  it("возвращает 0 если ни одна доля не попадает в окно", () => {
    const sum = expenseAmountInWindow(
      expense({ amount: 30000, date: "2025-01-01", mode: "by_payment_date" }),
      2026, 6, 2026, 6,
    )
    assert.equal(sum, 0)
  })

  it("amortized: возвращает только доли внутри окна", () => {
    // Принтер 30 000 на 3 месяца с 2026-06. Окно отчёта = только июль.
    const e = expense({
      amount: 30000, date: "2026-06-01", mode: "amortized",
      months: 3, start: "2026-06-01",
    })
    assert.equal(expenseAmountInWindow(e, 2026, 7, 2026, 7), 10000)
    // Окно = весь июнь–август:
    assert.equal(expenseAmountInWindow(e, 2026, 6, 2026, 8), 30000)
    // Окно = только май:
    assert.equal(expenseAmountInWindow(e, 2026, 5, 2026, 5), 0)
  })

  it("single_period: правильно фильтрует по окну", () => {
    // Аренда июня уплачена 25 мая, окно = май → 0, окно = июнь → 30 000.
    const e = expense({
      amount: 30000, date: "2026-05-25", mode: "single_period",
      start: "2026-06-01",
    })
    assert.equal(expenseAmountInWindow(e, 2026, 5, 2026, 5), 0)
    assert.equal(expenseAmountInWindow(e, 2026, 6, 2026, 6), 30000)
  })
})

describe("AMORTIZATION_LOOKBACK_MONTHS", () => {
  it("равно 60 (соответствует UI-лимиту amortizationMonths)", () => {
    assert.equal(AMORTIZATION_LOOKBACK_MONTHS, 60)
  })
})
