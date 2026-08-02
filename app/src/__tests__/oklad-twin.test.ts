import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"

const baseInput = {
  tenantId: "t1",
  categoryId: "cat-oklad",
  salaryPaymentId: "sp1",
  date: new Date("2026-08-01T00:00:00.000Z"),
  recognitionMode: "single_period" as const,
  amortizationStartDate: new Date("2026-07-01T00:00:00.000Z"),
  amortizationMonths: 1,
  createdBy: "emp-owner",
}

describe("buildOkladTwinExpenses", () => {
  it("одна позиция без направления → один твин, directionId=null, date = месяц признания", () => {
    const out = buildOkladTwinExpenses({ ...baseInput, items: [{ directionId: null, amount: 40000 }] })
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], {
      tenantId: "t1", categoryId: "cat-oklad", accountId: null, amount: 40000,
      // date = amortizationStartDate (июль), а не дата выплаты (август) — якорь признания в ОПИУ.
      date: baseInput.amortizationStartDate, recognitionMode: "single_period",
      amortizationStartDate: baseInput.amortizationStartDate, amortizationMonths: 1,
      isVariable: false, createdBy: "emp-owner", salaryPaymentId: "sp1", directionId: null,
    })
  })

  it("by_payment_date (нет amortizationStartDate) → date = дата выплаты", () => {
    const out = buildOkladTwinExpenses({
      ...baseInput,
      recognitionMode: "by_payment_date",
      amortizationStartDate: null,
      amortizationMonths: null,
      items: [{ directionId: null, amount: 40000 }],
    })
    assert.equal(out[0].date, baseInput.date)
  })

  it("позиции по нескольким направлениям → один твин на направление, суммы агрегированы", () => {
    const out = buildOkladTwinExpenses({ ...baseInput, items: [
      { directionId: "d1", amount: 10000 },
      { directionId: "d2", amount: 5000 },
      { directionId: "d1", amount: 3000 },
    ] })
    const byDir = new Map(out.map((e) => [e.directionId, e.amount]))
    assert.equal(out.length, 2)
    assert.equal(byDir.get("d1"), 13000)
    assert.equal(byDir.get("d2"), 5000)
  })

  it("пустые позиции → пустой массив", () => {
    assert.deepEqual(buildOkladTwinExpenses({ ...baseInput, items: [] }), [])
  })
})
