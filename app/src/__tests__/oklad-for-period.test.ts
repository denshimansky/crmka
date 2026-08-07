import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { okladForPeriod, okladDaysFraction } from "../lib/salary/oklad-for-period"

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
