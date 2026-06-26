/**
 * Unit-тесты для getLastPaidLessonDate / nextDayUtc.
 *
 * Чистая логика без БД: подменяем Tx моком и проверяем форму запроса
 * (только списания chargeAmount > 0, сортировка по дате занятия desc) и
 * корректный перенос границы дня/месяца/года в nextDayUtc.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  getLastPaidLessonDate,
  nextDayUtc,
  validateWithdrawalDate,
  subscriptionPeriodEnd,
} from "../lib/subscriptions/last-paid-lesson-date"

type FindFirstArgs = { where: Record<string, any>; orderBy?: any; select?: any }

function makeTx(returnValue: any) {
  const calls: FindFirstArgs[] = []
  const tx = {
    attendance: {
      findFirst: async (args: FindFirstArgs) => {
        calls.push(args)
        return returnValue
      },
    },
  }
  return { tx, calls }
}

describe("getLastPaidLessonDate", () => {
  it("возвращает дату последнего платного занятия", async () => {
    const date = new Date("2026-06-15T00:00:00.000Z")
    const { tx, calls } = makeTx({ lesson: { date } })
    const res = await getLastPaidLessonDate(tx as any, "t", "sub1")
    assert.equal(res, date)
    // фильтр: только реальные списания с абонемента (chargeAmount > 0)
    assert.deepEqual(calls[0].where.chargeAmount, { gt: 0 })
    assert.equal(calls[0].where.tenantId, "t")
    assert.equal(calls[0].where.subscriptionId, "sub1")
    // последнее платное = максимальная дата занятия
    assert.deepEqual(calls[0].orderBy, { lesson: { date: "desc" } })
  })

  it("возвращает null, если платных посещений нет", async () => {
    const { tx } = makeTx(null)
    const res = await getLastPaidLessonDate(tx as any, "t", "sub1")
    assert.equal(res, null)
  })
})

describe("nextDayUtc", () => {
  it("следующий день в UTC", () => {
    assert.equal(
      nextDayUtc(new Date("2026-06-15T00:00:00.000Z")).toISOString(),
      "2026-06-16T00:00:00.000Z",
    )
  })

  it("перенос границы месяца", () => {
    assert.equal(
      nextDayUtc(new Date("2026-06-30T00:00:00.000Z")).toISOString(),
      "2026-07-01T00:00:00.000Z",
    )
  })

  it("перенос границы года", () => {
    assert.equal(
      nextDayUtc(new Date("2026-12-31T00:00:00.000Z")).toISOString(),
      "2027-01-01T00:00:00.000Z",
    )
  })
})

describe("validateWithdrawalDate", () => {
  const start = new Date("2026-06-01T00:00:00.000Z")
  // «сейчас» 22 июня (с временем) — сегодня по UTC = 2026-06-22
  const now = new Date("2026-06-22T10:00:00.000Z")
  // конец периода (июнь) = 30 июня
  const periodEnd = new Date("2026-06-30T00:00:00.000Z")

  it("дата в прошлом в пределах абонемента — immediate, без ошибки", () => {
    assert.deepEqual(
      validateWithdrawalDate(new Date("2026-06-15"), start, now, periodEnd),
      { error: null, mode: "immediate" },
    )
  })

  it("дата = сегодня (UTC) — immediate, допустима", () => {
    assert.deepEqual(
      validateWithdrawalDate(new Date("2026-06-22"), start, now, periodEnd),
      { error: null, mode: "immediate" },
    )
  })

  it("дата в будущем в пределах периода — scheduled, без ошибки", () => {
    assert.deepEqual(
      validateWithdrawalDate(new Date("2026-06-30"), start, now, periodEnd),
      { error: null, mode: "scheduled" },
    )
  })

  it("дата в будущем за пределами периода — scheduled с ошибкой", () => {
    const res = validateWithdrawalDate(new Date("2026-07-05"), start, now, periodEnd)
    assert.equal(res.mode, "scheduled")
    assert.ok(res.error)
  })

  it("дата раньше начала абонемента — ошибка", () => {
    assert.ok(validateWithdrawalDate(new Date("2026-05-31"), start, now, periodEnd).error)
  })

  it("некорректная дата — ошибка", () => {
    assert.ok(validateWithdrawalDate(new Date("нет"), start, now, periodEnd).error)
  })
})

describe("subscriptionPeriodEnd", () => {
  it("берёт endDate, если задан", () => {
    const end = new Date("2026-06-30T00:00:00.000Z")
    assert.equal(
      subscriptionPeriodEnd({ endDate: end, periodYear: 2026, periodMonth: 6 }).toISOString(),
      "2026-06-30T00:00:00.000Z",
    )
  })

  it("без endDate — последний день месяца периода", () => {
    assert.equal(
      subscriptionPeriodEnd({ endDate: null, periodYear: 2026, periodMonth: 6 }).toISOString(),
      "2026-06-30T00:00:00.000Z",
    )
  })

  it("февраль високосного года", () => {
    assert.equal(
      subscriptionPeriodEnd({ endDate: null, periodYear: 2028, periodMonth: 2 }).toISOString(),
      "2028-02-29T00:00:00.000Z",
    )
  })
})
