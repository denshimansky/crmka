/**
 * Unit-тесты пропорционального перерасчёта SaaS при смене числа филиалов
 * внутри оплаченного периода (по дням). Денежная логика — считаем вручную.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computeBranchProration,
  selectProrationBase,
  MIN_ADJUSTMENT_RUB,
} from "../lib/billing/branch-proration"

const D = (s: string) => new Date(s + "T00:00:00.000Z")

// Счёт-кандидат для selectProrationBase (минимальные поля).
const inv = (
  isAdjustment: boolean,
  start: string,
  end: string,
  periodMonths = 12
) => ({ isAdjustment, periodStart: D(start), periodEnd: D(end), periodMonths })

// Годовой период 2026: 01.01–31.12 = 365 дней.
const YEAR = { periodStart: D("2026-01-01"), periodEnd: D("2026-12-31") }
// Квартальный период 2026: 01.01–31.03 = 90 дней (янв 31 + фев 28 + мар 31).
const Q1 = { periodStart: D("2026-01-01"), periodEnd: D("2026-03-31") }

describe("computeBranchProration — guard-случаи (null)", () => {
  it("помесячная оплата (periodMonths ≤ 1) — не тарифицируем", () => {
    assert.equal(
      computeBranchProration({
        periodMonths: 1,
        oldMonthly: 5000,
        newMonthly: 9000,
        ...YEAR,
        changeDate: D("2026-06-01"),
      }),
      null
    )
  })

  it("цена не изменилась — no-op", () => {
    assert.equal(
      computeBranchProration({
        periodMonths: 12,
        oldMonthly: 9000,
        newMonthly: 9000,
        ...YEAR,
        changeDate: D("2026-06-01"),
      }),
      null
    )
  })

  it("смена ДО начала периода — вне диапазона", () => {
    assert.equal(
      computeBranchProration({
        periodMonths: 12,
        oldMonthly: 9000,
        newMonthly: 12500,
        ...YEAR,
        changeDate: D("2025-12-31"),
      }),
      null
    )
  })

  it("смена ПОСЛЕ конца периода — вне диапазона", () => {
    assert.equal(
      computeBranchProration({
        periodMonths: 12,
        oldMonthly: 9000,
        newMonthly: 12500,
        ...YEAR,
        changeDate: D("2027-01-01"),
      }),
      null
    )
  })

  it("сумма ниже порога MIN_ADJUSTMENT_RUB — не выставляем", () => {
    // 3 мес, разница 10 ₽/мес, остался 1 день из 90: 10×3×(1/90) = 0.33 ₽ < 1
    const r = computeBranchProration({
      periodMonths: 3,
      oldMonthly: 5000,
      newMonthly: 5010,
      ...Q1,
      changeDate: D("2026-03-31"),
    })
    assert.equal(r, null)
    assert.ok(MIN_ADJUSTMENT_RUB >= 1)
  })
})

describe("computeBranchProration — доплата (рост филиалов)", () => {
  it("годовой период, +1 филиал с середины: 3500×12×184/365 = 21172.6", () => {
    const r = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 9000, // 2 филиала
      newMonthly: 12500, // 3 филиала
      ...YEAR,
      changeDate: D("2026-07-01"),
    })
    assert.ok(r)
    assert.equal(r!.kind, "charge")
    assert.equal(r!.totalDays, 365)
    assert.equal(r!.remainingDays, 184) // 01.07–31.12
    assert.equal(r!.amount, 21172.6)
  })

  it("смена в первый день периода → полный период (remaining=total)", () => {
    const r = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 9000,
      newMonthly: 12500,
      ...YEAR,
      changeDate: D("2026-01-01"),
    })
    assert.ok(r)
    assert.equal(r!.kind, "charge")
    assert.equal(r!.remainingDays, 365)
    assert.equal(r!.totalDays, 365)
    assert.equal(r!.amount, 42000) // 3500 × 12 × 1
  })

  it("смена в последний день периода → остаток 1 день", () => {
    const r = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 9000,
      newMonthly: 12500,
      ...YEAR,
      changeDate: D("2026-12-31"),
    })
    assert.ok(r)
    assert.equal(r!.remainingDays, 1)
    assert.equal(r!.amount, 115.07) // 42000 / 365
  })

  it("квартальный период, середина: 3500×3×45/90 = 5250", () => {
    const r = computeBranchProration({
      periodMonths: 3,
      oldMonthly: 9000,
      newMonthly: 12500,
      ...Q1,
      changeDate: D("2026-02-15"),
    })
    assert.ok(r)
    assert.equal(r!.kind, "charge")
    assert.equal(r!.totalDays, 90)
    assert.equal(r!.remainingDays, 45) // 15.02–31.03
    assert.equal(r!.amount, 5250)
  })
})

describe("computeBranchProration — кредит (снижение филиалов)", () => {
  it("годовой период, −1 филиал: 3500×12×92/365 = 10586.3 (credit)", () => {
    const r = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 12500, // 3 филиала
      newMonthly: 9000, // 2 филиала
      ...YEAR,
      changeDate: D("2026-10-01"),
    })
    assert.ok(r)
    assert.equal(r!.kind, "credit")
    assert.equal(r!.remainingDays, 92) // 01.10–31.12
    assert.equal(r!.amount, 10586.3)
  })
})

describe("computeBranchProration — телескопирование двух смен", () => {
  it("m1→m2 и m2→m3 в сумме = посуточная тарификация по составу", () => {
    // Период: 01.01–31.12 (365). Смена A 01.05 (9000→12500), смена B 01.09 (12500→17000).
    const a = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 9000,
      newMonthly: 12500,
      ...YEAR,
      changeDate: D("2026-05-01"),
    })
    const b = computeBranchProration({
      periodMonths: 12,
      oldMonthly: 12500,
      newMonthly: 17000,
      ...YEAR,
      changeDate: D("2026-09-01"),
    })
    assert.ok(a && b)
    assert.equal(a!.kind, "charge")
    assert.equal(b!.kind, "charge")
    // remainingDays A: 01.05–31.12 = 245; B: 01.09–31.12 = 122
    assert.equal(a!.remainingDays, 245)
    assert.equal(b!.remainingDays, 122)

    // Каждая смена доплачивает разницу цены за свой остаток периода;
    // в сумме это эквивалентно посуточной тарификации по факт. составу.
    assert.equal(a!.amount, Math.round(3500 * 12 * (245 / 365) * 100) / 100)
    assert.equal(b!.amount, Math.round(4500 * 12 * (122 / 365) * 100) / 100)
  })
})

describe("selectProrationBase — выбор базы перерасчёта", () => {
  const annual = inv(false, "2026-01-01", "2026-12-31")

  it("нет покрывающего периодного счёта → null", () => {
    assert.equal(selectProrationBase([], D("2026-07-01")), null)
    // только доплатный, покрывающий сегодня — не годится как база
    assert.equal(
      selectProrationBase([inv(true, "2026-05-01", "2026-12-31")], D("2026-07-01")),
      null
    )
  })

  it("исключает доплатные счета, берёт периодный", () => {
    const adjustment = inv(true, "2026-05-01", "2026-12-31")
    // Порядок в массиве произвольный — всё равно выбирается периодный годовой
    assert.equal(selectProrationBase([adjustment, annual], D("2026-10-01")), annual)
    assert.equal(selectProrationBase([annual, adjustment], D("2026-10-01")), annual)
  })

  it("учитывает границы периода (today вне периода → не выбирается)", () => {
    assert.equal(selectProrationBase([annual], D("2025-12-31")), null)
    assert.equal(selectProrationBase([annual], D("2027-01-01")), null)
    assert.equal(selectProrationBase([annual], D("2026-01-01")), annual)
    assert.equal(selectProrationBase([annual], D("2026-12-31")), annual)
  })

  it("несколько периодных → самый свежий по началу периода", () => {
    const q3 = inv(false, "2026-07-01", "2026-09-30", 3)
    const q4 = inv(false, "2026-10-01", "2026-12-31", 3)
    // 2026-11-01 покрывается q4 (и не покрывается q3) → q4
    assert.equal(selectProrationBase([q3, q4], D("2026-11-01")), q4)
  })
})

// Регрессия бага телескопирования: после оплаты доплатного счёта база следующего
// перерасчёта ДОЛЖНА оставаться исходным годовым счётом (totalDays=365), а не
// укороченным доплатным (totalDays=245/184). Собираем оркестрацию из чистых
// selectProrationBase + computeBranchProration на реальной последовательности.
describe("телескопирование через оркестрацию (регресс выбора базы)", () => {
  it("рост→оплата доплаты→снижение считает обе смены по полному году", () => {
    const invoices = [inv(false, "2026-01-01", "2026-12-31", 12)] // оплаченный год

    // Смена 1: 01.05, 2→3 филиала (9000→12500)
    const base1 = selectProrationBase(invoices, D("2026-05-01"))
    assert.ok(base1)
    const p1 = computeBranchProration({
      periodMonths: base1!.periodMonths,
      oldMonthly: 9000,
      newMonthly: 12500,
      periodStart: base1!.periodStart,
      periodEnd: base1!.periodEnd,
      changeDate: D("2026-05-01"),
    })
    assert.ok(p1)
    assert.equal(p1!.kind, "charge")
    assert.equal(p1!.totalDays, 365)

    // Доплатный счёт (укороченный хвост) оплачен и попал в пул оплаченных
    invoices.push(inv(true, "2026-05-01", "2026-12-31", 12))

    // Смена 2: 01.09, 3→2 филиала (12500→9000)
    const base2 = selectProrationBase(invoices, D("2026-09-01"))
    // КЛЮЧЕВОЕ: база — годовой счёт, НЕ доплатный (иначе totalDays=245)
    assert.equal(base2, invoices[0])
    const p2 = computeBranchProration({
      periodMonths: base2!.periodMonths,
      oldMonthly: 12500,
      newMonthly: 9000,
      periodStart: base2!.periodStart,
      periodEnd: base2!.periodEnd,
      changeDate: D("2026-09-01"),
    })
    assert.ok(p2)
    assert.equal(p2!.kind, "credit")
    assert.equal(p2!.totalDays, 365) // полный год, не укороченный хвост
    assert.equal(p2!.remainingDays, 122) // 01.09–31.12
    assert.equal(p2!.amount, Math.round(3500 * 12 * (122 / 365) * 100) / 100)
  })
})
