/**
 * Unit-тесты движка дат индивидуального биллинга (Bug #65): клампинг 29/30/31
 * без дрейфа, конец теста/якорь, предикат «пора выставлять».
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  daysInMonth,
  dueDateForMonth,
  nextDueDate,
  periodEndForAnchor,
  trialEndFromStart,
  anchorDayFromTrialEnd,
  shouldIssueAnchored,
  planInvoice,
} from "../lib/billing/billing-schedule"

const D = (s: string) => new Date(s + "T00:00:00.000Z")
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe("daysInMonth", () => {
  it("считает дни месяца, високосность февраля", () => {
    assert.equal(daysInMonth(2027, 0), 31) // Jan
    assert.equal(daysInMonth(2027, 1), 28) // Feb невисокосный
    assert.equal(daysInMonth(2028, 1), 29) // Feb високосный
    assert.equal(daysInMonth(2027, 3), 30) // Apr
    assert.equal(daysInMonth(2027, 11), 31) // Dec
  })
})

describe("dueDateForMonth — клампинг короткого месяца", () => {
  it("31 → последний день короткого месяца", () => {
    assert.equal(iso(dueDateForMonth(31, 2027, 1)), "2027-02-28")
    assert.equal(iso(dueDateForMonth(31, 2028, 1)), "2028-02-29")
    assert.equal(iso(dueDateForMonth(31, 2027, 3)), "2027-04-30")
  })
  it("30/29 клампятся в феврале, 28 всегда точен", () => {
    assert.equal(iso(dueDateForMonth(30, 2027, 1)), "2027-02-28")
    assert.equal(iso(dueDateForMonth(30, 2028, 1)), "2028-02-29")
    assert.equal(iso(dueDateForMonth(29, 2027, 1)), "2027-02-28")
    assert.equal(iso(dueDateForMonth(28, 2027, 1)), "2027-02-28")
    assert.equal(iso(dueDateForMonth(15, 2027, 5)), "2027-06-15")
  })
})

describe("nextDueDate — восстановление без дрейфа (ключевое)", () => {
  it("28 фев + якорь 31 → 31 мар, НЕ 28 мар", () => {
    assert.equal(iso(nextDueDate(D("2027-02-28"), 31)), "2027-03-31")
    assert.equal(iso(nextDueDate(D("2028-02-29"), 31)), "2028-03-31")
    assert.equal(iso(nextDueDate(D("2027-04-30"), 31)), "2027-05-31")
    assert.equal(iso(nextDueDate(D("2027-11-30"), 31)), "2027-12-31")
  })
  it("перенос года", () => {
    assert.equal(iso(nextDueDate(D("2027-12-31"), 31)), "2028-01-31")
    assert.equal(iso(nextDueDate(D("2027-12-15"), 15)), "2028-01-15")
  })
  it("несколько месяцев (periodMonths)", () => {
    assert.equal(iso(nextDueDate(D("2027-01-31"), 31, 3)), "2027-04-30")
    assert.equal(iso(nextDueDate(D("2027-11-30"), 31, 3)), "2028-02-29")
  })
})

describe("periodEndForAnchor — последний день периода", () => {
  it("день перед следующим сроком", () => {
    assert.equal(iso(periodEndForAnchor(D("2027-01-31"), 31, 1)), "2027-02-27")
    assert.equal(iso(periodEndForAnchor(D("2027-02-28"), 31, 1)), "2027-03-30")
    assert.equal(iso(periodEndForAnchor(D("2027-01-31"), 31, 3)), "2027-04-29")
  })
})

describe("trialEndFromStart / anchorDayFromTrialEnd", () => {
  it("старт 5-го → тест до 19-го → якорь 19 (пример владельца)", () => {
    const end = trialEndFromStart(D("2026-08-05"))
    assert.equal(iso(end), "2026-08-19")
    assert.equal(anchorDayFromTrialEnd(end), 19)
  })
  it("старт 17-го (31-дн месяц) → якорь 31", () => {
    const end = trialEndFromStart(D("2026-08-17"))
    assert.equal(iso(end), "2026-08-31")
    assert.equal(anchorDayFromTrialEnd(end), 31)
  })
  it("старт 15 фев (невисокосный) → 1 мар → якорь 1", () => {
    const end = trialEndFromStart(D("2027-02-15"))
    assert.equal(iso(end), "2027-03-01")
    assert.equal(anchorDayFromTrialEnd(end), 1)
  })
  it("старт 18-го (30-дн месяц) → 2-е → якорь 2", () => {
    const end = trialEndFromStart(D("2026-04-18"))
    assert.equal(iso(end), "2026-05-02")
    assert.equal(anchorDayFromTrialEnd(end), 2)
  })
})

describe("shouldIssueAnchored — за 10 дней до срока", () => {
  const due = D("2026-08-19")
  it("раньше -10 дней — нет, с -10 и позже — да", () => {
    assert.equal(shouldIssueAnchored(D("2026-08-08"), due), false) // due-11
    assert.equal(shouldIssueAnchored(D("2026-08-09"), due), true) // due-10
    assert.equal(shouldIssueAnchored(D("2026-08-18"), due), true)
    assert.equal(shouldIssueAnchored(D("2026-08-19"), due), true)
    assert.equal(shouldIssueAnchored(D("2026-08-24"), due), true) // просрочка
  })
})

describe("planInvoice — LEGACY (billingAnchorDay = null)", () => {
  const legacy = (nextPay: string, months = 1) => ({
    billingAnchorDay: null,
    nextPaymentDate: D(nextPay),
    billingPeriodMonths: months,
  })
  it("до 20-го не выставляет", () => {
    assert.equal(planInvoice(legacy("2026-09-01"), D("2026-08-19")), null)
  })
  it("с 20-го — счёт на 1-е число следующего месяца, срок 1-е", () => {
    const p = planInvoice(legacy("2026-09-01"), D("2026-08-20"))
    assert.ok(p)
    assert.equal(iso(p!.periodStart), "2026-09-01")
    assert.equal(iso(p!.dueDate), "2026-09-01")
    assert.equal(iso(p!.periodEnd), "2026-09-30")
    assert.deepEqual(p!.idempotencyStatuses, ["pending", "paid"])
    assert.equal(p!.isPastDuePeriod, false)
  })
  it("оплачено вперёд (nextPay > след. месяца) — не выставляет", () => {
    assert.equal(planInvoice(legacy("2026-10-01"), D("2026-08-20")), null)
  })
  it("долг за прошлый период → isPastDuePeriod", () => {
    const p = planInvoice(legacy("2026-07-01"), D("2026-08-20"))
    assert.ok(p)
    assert.equal(p!.isPastDuePeriod, true)
    assert.equal(iso(p!.periodStart), "2026-09-01")
  })
  it("periodMonths=3 → период до конца 3-го месяца", () => {
    const p = planInvoice(legacy("2026-09-01", 3), D("2026-08-20"))
    assert.equal(iso(p!.periodEnd), "2026-11-30")
  })
})

describe("planInvoice — ANCHORED (billingAnchorDay задан)", () => {
  const anchored = (anchor: number, nextPay: string, months = 1) => ({
    billingAnchorDay: anchor,
    nextPaymentDate: D(nextPay),
    billingPeriodMonths: months,
  })
  it("раньше -10 дней — не выставляет, ровно за 10 — выставляет", () => {
    assert.equal(planInvoice(anchored(19, "2026-08-19"), D("2026-08-08")), null)
    const p = planInvoice(anchored(19, "2026-08-19"), D("2026-08-09"))
    assert.ok(p)
    assert.equal(iso(p!.periodStart), "2026-08-19")
    assert.equal(iso(p!.dueDate), "2026-08-19")
    assert.equal(iso(p!.periodEnd), "2026-09-18")
    assert.deepEqual(p!.idempotencyStatuses, ["pending", "paid", "overdue"])
  })
  it("якорь ≤10 (дата выставления в прошлом месяце) — всё равно выставляет (BUG-1)", () => {
    // Старый DB-фильтр nextPaymentDate<=1-е след. месяца уронил бы этот счёт
    assert.equal(planInvoice(anchored(3, "2026-09-03"), D("2026-08-23")), null) // -11
    const p = planInvoice(anchored(3, "2026-09-03"), D("2026-08-24")) // -10
    assert.ok(p)
    assert.equal(iso(p!.periodStart), "2026-09-03")
  })
  it("periodMonths=3 с клампингом якоря 31", () => {
    const p = planInvoice(anchored(31, "2027-01-31", 3), D("2027-01-25"))
    assert.equal(iso(p!.periodEnd), "2027-04-29")
  })
})

describe("Золотая рекуррентность (anchor 31, 1 мес, невисокосный 2027)", () => {
  it("due/periodEnd/nextPay восстанавливаются к 31 без дрейфа", () => {
    const anchor = 31
    // Стартуем с первого срока 2027-01-31
    let due = D("2027-01-31")
    const expected = [
      { due: "2027-01-31", periodEnd: "2027-02-27", nextPay: "2027-02-28" },
      { due: "2027-02-28", periodEnd: "2027-03-30", nextPay: "2027-03-31" },
      { due: "2027-03-31", periodEnd: "2027-04-29", nextPay: "2027-04-30" },
      { due: "2027-04-30", periodEnd: "2027-05-30", nextPay: "2027-05-31" },
    ]
    for (const step of expected) {
      const periodEnd = periodEndForAnchor(due, anchor, 1)
      // nextPaymentDate = periodEnd + 1 день (как в apply-invoice-payment)
      const nextPay = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000)
      assert.equal(iso(due), step.due)
      assert.equal(iso(periodEnd), step.periodEnd)
      assert.equal(iso(nextPay), step.nextPay)
      due = nextPay
    }
  })
})
