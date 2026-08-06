import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { splitEmployeeByKind, kindOfDirection, applyPenaltyToItems } from "../lib/salary/kind-split"

describe("applyPenaltyToItems (штраф вычитается из выплаты)", () => {
  it("оклад: штраф уменьшает единственную позицию", () => {
    const out = applyPenaltyToItems([{ directionId: null, amount: 12437 }], 1200, null)
    assert.deepEqual(out, [{ directionId: null, amount: 11237 }])
  })
  it("нет штрафа — позиции без изменений", () => {
    const out = applyPenaltyToItems([{ directionId: "d1", amount: 500 }], 0, "d1")
    assert.deepEqual(out, [{ directionId: "d1", amount: 500 }])
  })
  it("штраф больше суммы — позиция обнуляется (выплаты нет)", () => {
    const out = applyPenaltyToItems([{ directionId: null, amount: 800 }], 1200, null)
    assert.deepEqual(out, [])
  })
  it("сделка: штраф сперва по своему направлению, потом каскад", () => {
    const out = applyPenaltyToItems(
      [{ directionId: "d1", amount: 300 }, { directionId: "d2", amount: 1000 }],
      500, "d2",
    )
    // 500 штрафа: d2 (1000) → 500; d1 не тронут.
    assert.deepEqual(out, [{ directionId: "d2", amount: 500 }, { directionId: "d1", amount: 300 }])
  })
  it("сделка: штраф больше направления — добивает каскадом", () => {
    const out = applyPenaltyToItems(
      [{ directionId: "d1", amount: 300 }, { directionId: "d2", amount: 400 }],
      500, "d2",
    )
    // d2 (400) обнулён, остаток 100 снят с d1 (300→200).
    assert.deepEqual(out, [{ directionId: "d1", amount: 200 }])
  })
})

describe("kindOfDirection", () => {
  it("у окладника: без направления → оклад, направление → сделка", () => {
    assert.equal(kindOfDirection(null, true), "salary")
    assert.equal(kindOfDirection("d1", true), "piece")
  })
  it("без оклада: всё → сделка (в т.ч. без направления)", () => {
    assert.equal(kindOfDirection(null, false), "piece")
    assert.equal(kindOfDirection("d1", false), "piece")
  })
})

describe("splitEmployeeByKind", () => {
  it("совместитель (Золотарёва): оклад отдельно от сделки, остатки не смешиваются", () => {
    // Оклад 5000 (без направления). Июль: сделка начислена 25 440, выплачено
    // всего 30 440 = 5000 без направления (оклад) + 25 440 по направлениям (сделка).
    const res = splitEmployeeByKind({
      monthlySalary: 5000,
      pieceAccrued: 25440,
      paymentItems: [
        { directionId: null, amount: 2500 },
        { directionId: null, amount: 2500 },
        { directionId: "raz", amount: 5638 },
        { directionId: "raz", amount: 242 },
        { directionId: "skoro", amount: 3120 },
        { directionId: "cht", amount: 1320 },
        { directionId: "kal", amount: 1080 },
        { directionId: "raz", amount: 6151 },
        { directionId: "raz", amount: 809 },
        { directionId: "skoro", amount: 4200 },
        { directionId: "cht", amount: 1920 },
        { directionId: "kal", amount: 960 },
      ],
      adjustments: [],
    })
    // Оклад: начислено 5000, выплачено 5000 (обе строки без направления), остаток 0.
    assert.equal(res.salary.accrued, 5000)
    assert.equal(res.salary.paid, 5000)
    assert.equal(res.salary.remaining, 0)
    // Сделка: начислено 25 440, выплачено 25 440, остаток 0 — БЕЗ ложного −25 440.
    assert.equal(res.piece.accrued, 25440)
    assert.equal(res.piece.paid, 25440)
    assert.equal(res.piece.remaining, 0)
  })

  it("чистый сдельщик (без оклада): всё на сделку, окладная вкладка пуста", () => {
    const res = splitEmployeeByKind({
      monthlySalary: 0,
      pieceAccrued: 4000,
      paymentItems: [
        { directionId: "d1", amount: 1000 },
        { directionId: null, amount: 500 }, // выплаченная премия без направления
      ],
      adjustments: [
        { directionId: null, type: "bonus", amount: 500 }, // премия без направления → сделка
      ],
    })
    assert.deepEqual(res.salary, { accrued: 0, bonuses: 0, penalties: 0, paid: 0, remaining: 0 })
    assert.equal(res.piece.accrued, 4000)
    assert.equal(res.piece.bonuses, 500)
    assert.equal(res.piece.paid, 1500)
    assert.equal(res.piece.remaining, 3000) // 4000 + 500 − 0 − 1500
  })

  it("окладник-администратор с премией без направления → всё на оклад", () => {
    const res = splitEmployeeByKind({
      monthlySalary: 6000,
      pieceAccrued: 0,
      paymentItems: [{ directionId: null, amount: 7000 }],
      adjustments: [{ directionId: null, type: "bonus", amount: 1000 }],
    })
    assert.equal(res.salary.accrued, 6000)
    assert.equal(res.salary.bonuses, 1000)
    assert.equal(res.salary.paid, 7000)
    assert.equal(res.salary.remaining, 0)
    assert.equal(res.piece.accrued, 0)
    assert.equal(res.piece.remaining, 0)
  })

  it("совместитель с направленной сдельной премией и штрафом", () => {
    const res = splitEmployeeByKind({
      monthlySalary: 5000,
      pieceAccrued: 3000,
      paymentItems: [
        { directionId: null, amount: 5000 }, // оклад
        { directionId: "d1", amount: 500 },  // выплата сделочной премии по d1
      ],
      adjustments: [
        { directionId: "d1", type: "bonus", amount: 500 },   // сделочная премия
        { directionId: "d1", type: "penalty", amount: 200 }, // сделочный штраф
        { directionId: null, type: "penalty", amount: 100 }, // окладный штраф
      ],
    })
    // Оклад: 5000 начислено, штраф 100, выплачено 5000 → остаток −100.
    assert.equal(res.salary.accrued, 5000)
    assert.equal(res.salary.penalties, 100)
    assert.equal(res.salary.paid, 5000)
    assert.equal(res.salary.remaining, -100)
    // Сделка: 3000 + 500 премия − 200 штраф − 500 выплачено = 2800.
    assert.equal(res.piece.bonuses, 500)
    assert.equal(res.piece.penalties, 200)
    assert.equal(res.piece.paid, 500)
    assert.equal(res.piece.remaining, 2800)
  })

  it("инвариант: сумма по вкладкам == общий остаток", () => {
    const input = {
      monthlySalary: 5000,
      pieceAccrued: 3000,
      paymentItems: [
        { directionId: null, amount: 4000 },
        { directionId: "d1", amount: 1000 },
      ],
      adjustments: [
        { directionId: "d1", type: "bonus" as const, amount: 300 },
        { directionId: null, type: "penalty" as const, amount: 200 },
      ],
    }
    const res = splitEmployeeByKind(input)
    const total = 3000 + 5000 + 300 - 200 - 5000 // accrued+bonuses−penalties−paid
    assert.equal(res.piece.remaining + res.salary.remaining, total)
  })
})
