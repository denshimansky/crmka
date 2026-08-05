import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { allocateSalaryPayments, capPresetsToBudget, NO_DIR } from "../lib/salary/allocate-payments"

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

  it("окладник d1 + ВЫПЛАЧЕННАЯ премия: премия гасит adjustments, не оклад (регрессия #2)", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: "d1", accrued: 10000 }],
      paidByDir: new Map(),
      paidNoDirection: 2000,      // выплаченная премия (item directionId=null)
      okladDirectionId: "d1",
      netAdjustment: 2000,        // начислена премия 2000
    })
    assert.equal(res.paidByRow.get("d1"), 0)     // оклад НЕ тронут (был бы 2000 без фикса)
    assert.equal(res.adjPaidNoDirection, 2000)   // премия зачтена в премии−штрафы
  })

  it("премия гасится раньше оклада, излишек — на оклад (net>0, выплата больше премии)", () => {
    const res = allocateSalaryPayments({
      accruals: [{ directionId: null, accrued: 7400 }],
      paidByDir: new Map(),
      paidNoDirection: 4520,      // 1000 премия + 3520 аванс оклада
      okladDirectionId: null,
      netAdjustment: 1000,
    })
    assert.equal(res.paidByRow.get(NO_DIR), 3520) // на оклад пошло 4520 − 1000
    assert.equal(res.adjPaidNoDirection, 1000)    // премия
  })

  it("capPresetsToBudget: каскадное ограничение общим бюджетом", () => {
    assert.deepEqual(capPresetsToBudget([7400, 0], 5400), [5400, 0])       // депремирование
    assert.deepEqual(capPresetsToBudget([3000, 2000], 4000), [3000, 1000]) // второй урезан
    assert.deepEqual(capPresetsToBudget([1000, 500], 5000), [1000, 500])   // бюджет с запасом
    assert.deepEqual(capPresetsToBudget([1000], -100), [0])                // отрицательный бюджет
  })
})
