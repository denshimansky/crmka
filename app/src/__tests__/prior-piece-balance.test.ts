// Тесты чистого расчёта «Доначислено» (накопленный сделочный остаток прошлых
// периодов). DB-обёртка (computePriorPieceBalances) здесь не тестируется — только
// формула и разделение сделка/оклад.
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computePriorPieceBalanceOne, computePriorOkladBalanceOne, ymNum } from "@/lib/salary/prior-piece-balance"

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

// ── Окладное «Доначислено»: перенос недоплаты/переплаты оклада между месяцами ──
const dt = (s: string) => new Date(s + "T00:00:00.000Z")

describe("computePriorOkladBalanceOne", () => {
  it("невыплаченный оклад июля всплывает в августе", () => {
    // Оклад 18 000 с 01.07, июль не выплачен. Считаем на август (endYm = июль).
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 18000,
      okladFrom: dt("2026-07-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
    })
    assert.equal(balance, 18000)
  })

  it("выплаченный оклад долга не оставляет", () => {
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 18000,
      okladFrom: dt("2026-07-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
      paidByPeriod: new Map([[ymNum(2026, 7), 18000]]),
    })
    assert.equal(balance, 0)
  })

  it("переплата уходит в минус", () => {
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 18000,
      okladFrom: dt("2026-07-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
      paidByPeriod: new Map([[ymNum(2026, 7), 20000]]),
    })
    assert.equal(balance, -2000)
  })

  it("окладные премии и штрафы входят в остаток", () => {
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 10000,
      okladFrom: dt("2026-07-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
      adjByPeriod: new Map([[ymNum(2026, 7), -3000]]), // штраф 3 000
      paidByPeriod: new Map([[ymNum(2026, 7), 7000]]),
    })
    assert.equal(balance, 0)
  })

  it("копит по нескольким месяцам", () => {
    // Июнь и июль по 18 000, выплачено только за июнь.
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 18000,
      okladFrom: dt("2026-06-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
      paidByPeriod: new Map([[ymNum(2026, 6), 18000]]),
    })
    assert.equal(balance, 18000)
  })

  it("версия «оклад 0» закрывает накопление с её даты (кейс Андреевой)", () => {
    // База 18 000 без даты начала, версия 0 с 01.08; первая операция — июнь.
    // На сентябрь: июнь 18 000 + июль 18 000 + август 0, выплачено 18 000+18 000.
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 18000,
      okladFrom: null,
      schedule: [{ effectiveFrom: dt("2026-08-01"), amount: 0 }],
      firstActivityYm: ymNum(2026, 6),
      endYm: ymNum(2026, 8),
      paidByPeriod: new Map([
        [ymNum(2026, 6), 18000],
        [ymNum(2026, 7), 18000],
      ]),
    })
    assert.equal(balance, 0)
  })

  it("без даты начала и без операций долг не выдумывается", () => {
    // Легаси-окладник (okladFrom пуст) без единой выплаты: окно не открывается.
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 50000,
      okladFrom: null,
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 8),
    })
    assert.equal(balance, 0)
  })

  it("без даты начала окно стартует с первой зарплатной операции", () => {
    // Оклад 10 000, первая операция — июль; на сентябрь считаем июль и август.
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 10000,
      okladFrom: null,
      schedule: [],
      firstActivityYm: ymNum(2026, 7),
      endYm: ymNum(2026, 8),
      paidByPeriod: new Map([[ymNum(2026, 7), 10000]]),
    })
    assert.equal(balance, 10000) // август не выплачен
  })

  it("оклад, начинающийся позже расчётного месяца, даёт 0", () => {
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 30000,
      okladFrom: dt("2026-09-01"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 8),
    })
    assert.equal(balance, 0)
  })

  it("неполный первый месяц копится пропорционально", () => {
    // Оклад 31 000 с 28.07 → 4 дня из 31; ничего не выплачено.
    const balance = computePriorOkladBalanceOne({
      monthlySalary: 31000,
      okladFrom: dt("2026-07-28"),
      schedule: [],
      firstActivityYm: null,
      endYm: ymNum(2026, 7),
    })
    assert.equal(balance, Math.round(31000 * (4 / 31) * 100) / 100)
  })
})
