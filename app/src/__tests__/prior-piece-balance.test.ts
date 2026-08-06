// Тесты чистого расчёта «Доначислено» (накопленный сделочный остаток прошлых
// периодов). DB-обёртка (computePriorPieceBalances) здесь не тестируется — только
// формула и разделение сделка/оклад.
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computePriorPieceBalanceOne } from "@/lib/salary/prior-piece-balance"

describe("computePriorPieceBalanceOne", () => {
  it("сдельщик: начислено − выплачено (ретро-прогул после выплаты)", () => {
    // Июль: занятия 1000 + ретро-«Прогул» 100 = 1100 начислено; выплачено 1000.
    const balance = computePriorPieceBalanceOne({
      hasOklad: false,
      priorAttendancePay: 1100,
      adjustments: [],
      payments: [{ directionId: "d1", amount: 1000 }],
    })
    assert.equal(balance, 100)
  })

  it("сдельщик: премии/штрафы без направления идут в сделку", () => {
    const balance = computePriorPieceBalanceOne({
      hasOklad: false,
      priorAttendancePay: 500,
      adjustments: [
        { directionId: null, type: "bonus", amount: 200 },
        { directionId: "d1", type: "penalty", amount: 50 },
      ],
      payments: [{ directionId: null, amount: 300 }],
    })
    // 500 + 200 − 50 − 300 = 350
    assert.equal(balance, 350)
  })

  it("окладник: null-направление = оклад, в сделочный остаток НЕ входит", () => {
    // Выплата без направления (600) — оклад, не гасит сделку; премия без направления — оклад.
    const balance = computePriorPieceBalanceOne({
      hasOklad: true,
      priorAttendancePay: 800,
      adjustments: [
        { directionId: null, type: "bonus", amount: 100 }, // оклад — игнор
        { directionId: "d1", type: "bonus", amount: 50 },   // сделка +50
      ],
      payments: [
        { directionId: null, amount: 600 }, // оклад — игнор
        { directionId: "d1", amount: 200 }, // сделка −200
      ],
    })
    // сделка: 800 + 50 − 200 = 650
    assert.equal(balance, 650)
  })

  it("переплата → отрицательный остаток", () => {
    const balance = computePriorPieceBalanceOne({
      hasOklad: false,
      priorAttendancePay: 700,
      adjustments: [],
      payments: [{ directionId: "d1", amount: 900 }],
    })
    assert.equal(balance, -200)
  })

  it("нет прошлой активности → 0", () => {
    assert.equal(
      computePriorPieceBalanceOne({ hasOklad: false, priorAttendancePay: 0, adjustments: [], payments: [] }),
      0,
    )
  })
})
