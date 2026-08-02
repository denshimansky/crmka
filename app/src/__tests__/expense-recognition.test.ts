import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveRecognition } from "@/lib/expense-recognition"

describe("resolveRecognition", () => {
  it("by_payment_date → без amortization-полей", () => {
    const r = resolveRecognition({ recognitionMode: "by_payment_date", singleMonth: "2026-07", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "by_payment_date", amortizationStartDate: undefined, amortizationMonths: undefined })
  })

  it("not_in_pnl → без amortization-полей", () => {
    const r = resolveRecognition({ recognitionMode: "not_in_pnl", singleMonth: "2026-07", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "not_in_pnl", amortizationStartDate: undefined, amortizationMonths: undefined })
  })

  it("single_period → 1 месяц, дата = 1-е число месяца признания", () => {
    const r = resolveRecognition({ recognitionMode: "single_period", singleMonth: "2026-05", amortStartMonth: "2026-07", amortMonths: "3" })
    assert.deepEqual(r, { recognitionMode: "single_period", amortizationStartDate: "2026-05-01", amortizationMonths: 1 })
  })

  it("amortized → N месяцев, дата = 1-е число стартового месяца", () => {
    const r = resolveRecognition({ recognitionMode: "amortized", singleMonth: "2026-07", amortStartMonth: "2026-09", amortMonths: "4" })
    assert.deepEqual(r, { recognitionMode: "amortized", amortizationStartDate: "2026-09-01", amortizationMonths: 4 })
  })

  it("amortized вне диапазона 2..60 → бросает ошибку с RU-сообщением", () => {
    assert.throws(
      () => resolveRecognition({ recognitionMode: "amortized", singleMonth: "2026-07", amortStartMonth: "2026-09", amortMonths: "1" }),
      /Количество месяцев должно быть от 2 до 60/,
    )
  })
})
