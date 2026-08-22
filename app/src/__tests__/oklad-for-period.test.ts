import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { okladForPeriod, okladDaysFraction, okladAmountOnDay } from "../lib/salary/oklad-for-period"

const d = (s: string) => new Date(s + "T00:00:00.000Z")

describe("okladForPeriod", () => {
  it("okladFrom не задан → полный оклад (обратная совместимость)", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 30000, okladFrom: null, periodYear: 2026, periodMonth: 7 }),
      30000,
    )
  })

  it("monthlySalary=0 → 0 (не окладник)", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 0, okladFrom: d("2026-07-01"), periodYear: 2026, periodMonth: 7 }),
      0,
    )
  })

  it("okladFrom в будущем месяце → 0 (баг Фирова: август не всплывает в июле)", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 25000, okladFrom: d("2026-08-01"), periodYear: 2026, periodMonth: 7 }),
      0,
    )
  })

  it("okladFrom в прошлом месяце → полный оклад", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 25000, okladFrom: d("2026-06-15"), periodYear: 2026, periodMonth: 7 }),
      25000,
    )
  })

  it("okladFrom = 1-е число месяца → полный оклад", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 31000, okladFrom: d("2026-07-01"), periodYear: 2026, periodMonth: 7 }),
      31000,
    )
  })

  it("okladFrom в середине месяца → пропорция по календарным дням (июль, 31 день)", () => {
    // с 28.07 по 31.07 = 4 дня из 31
    assert.equal(
      okladForPeriod({ monthlySalary: 31000, okladFrom: d("2026-07-28"), periodYear: 2026, periodMonth: 7 }),
      Math.round(31000 * (4 / 31) * 100) / 100,
    )
  })

  it("okladFrom = последний день месяца → 1/дней", () => {
    assert.equal(
      okladDaysFraction({ okladFrom: d("2026-07-31"), periodYear: 2026, periodMonth: 7 }),
      1 / 31,
    )
  })

  it("февраль високосный (2028) — 29 дней, пропорция с 15-го", () => {
    // 15..29 = 15 дней из 29
    assert.equal(
      okladDaysFraction({ okladFrom: d("2028-02-15"), periodYear: 2028, periodMonth: 2 }),
      15 / 29,
    )
  })

  it("аванс upToDay: полный окладник, по 15-е → 15/31", () => {
    assert.equal(
      okladDaysFraction({ okladFrom: null, periodYear: 2026, periodMonth: 7, upToDay: 15 }),
      15 / 31,
    )
  })

  it("аванс upToDay комбинируется с okladFrom: начало 10-го, аванс по 15-е → 6/31", () => {
    // окно [10..15] = 6 дней
    assert.equal(
      okladDaysFraction({ okladFrom: d("2026-07-10"), periodYear: 2026, periodMonth: 7, upToDay: 15 }),
      6 / 31,
    )
  })

  it("аванс по 5-е, а оклад начался 10-го → 0 (окно пустое)", () => {
    assert.equal(
      okladDaysFraction({ okladFrom: d("2026-07-10"), periodYear: 2026, periodMonth: 7, upToDay: 5 }),
      0,
    )
  })
})

// ── История версий оклада (OkladSchedule) ──────────────────────────────────────
// Базовая величина = «версия с начала времён»; версия действует ТОЛЬКО вперёд от
// своей даты, поэтому правка оклада больше не переписывает прошлые месяцы.
describe("okladForPeriod: версии оклада", () => {
  it("пустой список версий → как раньше (быстрый путь)", () => {
    assert.equal(
      okladForPeriod({ monthlySalary: 30000, okladFrom: null, schedule: [], periodYear: 2026, periodMonth: 7 }),
      30000,
    )
  })

  it("версия в будущем месяце прошлый не трогает (кейс Андреевой: 0 с августа)", () => {
    const schedule = [{ effectiveFrom: d("2026-08-01"), amount: 0 }]
    assert.equal(
      okladForPeriod({ monthlySalary: 18000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 6 }),
      18000,
    )
    assert.equal(
      okladForPeriod({ monthlySalary: 18000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 7 }),
      18000,
    )
    assert.equal(
      okladForPeriod({ monthlySalary: 18000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 8 }),
      0,
    )
  })

  it("версия с 1-го числа действует на весь месяц", () => {
    assert.equal(
      okladForPeriod({
        monthlySalary: 20000, okladFrom: null,
        schedule: [{ effectiveFrom: d("2026-07-01"), amount: 25000 }],
        periodYear: 2026, periodMonth: 7,
      }),
      25000,
    )
  })

  it("смена оклада в середине месяца делится по дням (июль: 20000 до 15-го, 32000 с 16-го)", () => {
    // 1..15 → 20000, 16..31 → 32000; (15×20000 + 16×32000)/31
    const expected = Math.round(((15 * 20000 + 16 * 32000) / 31) * 100) / 100
    assert.equal(
      okladForPeriod({
        monthlySalary: 20000, okladFrom: null,
        schedule: [{ effectiveFrom: d("2026-07-16"), amount: 32000 }],
        periodYear: 2026, periodMonth: 7,
      }),
      expected,
    )
  })

  it("несколько версий: берётся ближайшая слева от дня", () => {
    const schedule = [
      { effectiveFrom: d("2026-05-01"), amount: 10000 },
      { effectiveFrom: d("2026-07-01"), amount: 15000 },
      { effectiveFrom: d("2026-09-01"), amount: 0 },
    ]
    assert.equal(okladForPeriod({ monthlySalary: 5000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 6 }), 10000)
    assert.equal(okladForPeriod({ monthlySalary: 5000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 8 }), 15000)
    assert.equal(okladForPeriod({ monthlySalary: 5000, okladFrom: null, schedule, periodYear: 2026, periodMonth: 9 }), 0)
  })

  it("удалённая версия игнорируется", () => {
    assert.equal(
      okladForPeriod({
        monthlySalary: 18000, okladFrom: null,
        schedule: [{ effectiveFrom: d("2026-08-01"), amount: 0, deletedAt: d("2026-08-10") }],
        periodYear: 2026, periodMonth: 8,
      }),
      18000,
    )
  })

  it("версия не воскрешает оклад до okladFrom (база ещё не началась)", () => {
    // okladFrom = 01.07, версия с 01.08 → июнь по-прежнему 0
    assert.equal(
      okladForPeriod({
        monthlySalary: 18000, okladFrom: d("2026-07-01"),
        schedule: [{ effectiveFrom: d("2026-08-01"), amount: 25000 }],
        periodYear: 2026, periodMonth: 6,
      }),
      0,
    )
  })

  it("аванс upToDay учитывает версии: смена с 10-го, аванс по 15-е (июль)", () => {
    // 1..9 → 20000, 10..15 → 30000; делитель всегда 31
    const expected = Math.round(((9 * 20000 + 6 * 30000) / 31) * 100) / 100
    assert.equal(
      okladForPeriod({
        monthlySalary: 20000, okladFrom: null,
        schedule: [{ effectiveFrom: d("2026-07-10"), amount: 30000 }],
        periodYear: 2026, periodMonth: 7, upToDay: 15,
      }),
      expected,
    )
  })

  it("okladAmountOnDay: граница включительна", () => {
    const base = { monthlySalary: 18000, okladFrom: null }
    const schedule = [{ effectiveFrom: d("2026-08-01"), amount: 0 }]
    assert.equal(okladAmountOnDay(d("2026-07-31"), base, schedule), 18000)
    assert.equal(okladAmountOnDay(d("2026-08-01"), base, schedule), 0)
  })
})
