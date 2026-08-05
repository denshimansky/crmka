import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { allocateSalaryPayments, NO_DIR } from "../lib/salary/allocate-payments"

describe("allocateSalaryPayments", () => {
  it("окладник без направления: аванс без направления гасит null-строку", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: null, accrued: 7400 }],
      paidByDir: new Map(),
      paidNoDirection: 3520,
      okladDirectionId: null,
    })
    assert.equal(res.paidByRow.get(NO_DIR), 3520)
    assert.equal(res.adjPaidNoDirection, 0)
    assert.deepEqual(res.orphans, [])
  })

  it("окладник С направлением: выплата без направления гасит строку оклада d1 (#1)", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: "d1", accrued: 7400 }],
      paidByDir: new Map(),
      paidNoDirection: 3520,
      okladDirectionId: "d1",
    })
    assert.equal(res.paidByRow.get("d1"), 3520)
    assert.equal(res.adjPaidNoDirection, 0)
  })

  it("окладник d1: прямая выплата d1 + без направления складываются на строке d1", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: "d1", accrued: 7400 }],
      paidByDir: new Map([["d1", 2000]]),
      paidNoDirection: 1000,
      okladDirectionId: "d1",
    })
    assert.equal(res.paidByRow.get("d1"), 3000) // 2000 прямых + 1000 без направления
    assert.equal(res.adjPaidNoDirection, 0)
  })

  it("излишек выплат без направления сверх оклада уходит в премии−штрафы", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: null, accrued: 7400 }],
      paidByDir: new Map(),
      paidNoDirection: 8400,
      okladDirectionId: null,
    })
    assert.equal(res.paidByRow.get(NO_DIR), 7400)
    assert.equal(res.adjPaidNoDirection, 1000)
  })

  it("осиротевшая направленческая выплата (нет начисления) → orphans (#3)", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: "d1", accrued: 1000 }],
      paidByDir: new Map([["d1", 500], ["d2", 300]]),
      paidNoDirection: 0,
      okladDirectionId: undefined, // не окладник
    })
    assert.equal(res.paidByRow.get("d1"), 500)
    assert.deepEqual(res.orphans, [{ directionId: "d2", paid: 300 }])
    assert.equal(res.adjPaidNoDirection, 0)
  })

  it("не окладник: выплаты без направления не гасят направленческие начисления, идут в премии", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: "d1", accrued: 1000 }],
      paidByDir: new Map([["d1", 400]]),
      paidNoDirection: 300,
      okladDirectionId: undefined,
    })
    assert.equal(res.paidByRow.get("d1"), 400)
    assert.equal(res.adjPaidNoDirection, 300) // без направления → премии−штрафы
  })

  it("оклад d1 + прочие null-начисления: каскад оклад → null-строка", () => {
    const res = allocateSalaryPayments({
      accruals: [
        { directionId: "d1", accrued: 5000 },      // оклад
        { directionId: null, accrued: 1000 },       // сделка/занятия без направления
      ],
      paidByDir: new Map(),
      paidNoDirection: 5500,
      okladDirectionId: "d1",
    })
    assert.equal(res.paidByRow.get("d1"), 5000)   // оклад поглотил свои 5000
    assert.equal(res.paidByRow.get(NO_DIR), 500)  // остаток 500 каскадом в null-строку
    assert.equal(res.adjPaidNoDirection, 0)
  })
})
