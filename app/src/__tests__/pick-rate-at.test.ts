import { test } from "node:test"
import assert from "node:assert/strict"
import { pickRateAt } from "../lib/salary/pick-rate-at"

type Sched = { effectiveFrom: Date; deletedAt?: Date | null; tag: string }
const base = { ratePerLesson: 700, tag: "base" }
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const tagOf = (r: { tag: string }) => r.tag

test("нет версий → база", () => {
  // При [] / null дженерик S не выводится из аргумента — задаём его явно,
  // чтобы union B | S сохранял поле tag.
  assert.equal(tagOf(pickRateAt<typeof base, Sched>(base, [], utc(2026, 9, 1))), "base")
  assert.equal(tagOf(pickRateAt<typeof base, Sched>(base, null, utc(2026, 9, 1))), "base")
})

test("atDate до границы → база (старая ставка)", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 25))), "base")
})

test("atDate на границе (inclusive) → версия", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 1))), "v1")
})

test("atDate после границы → версия", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 15))), "v1")
})

test("несколько версий → ближайшая слева от atDate", () => {
  const schedules = [
    { effectiveFrom: utc(2026, 9, 1), tag: "v1" },
    { effectiveFrom: utc(2027, 1, 1), tag: "v2" },
  ]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 12, 31))), "v1")
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2027, 1, 1))), "v2")
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 1))), "base")
})

test("удалённая версия игнорируется", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), deletedAt: utc(2026, 8, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 9, 5))), "base")
})

test("ретро-стабильность: занятие до границы всегда база, когда бы ни резолвили", () => {
  const schedules = [{ effectiveFrom: utc(2026, 9, 1), tag: "v1" }]
  assert.equal(tagOf(pickRateAt(base, schedules, utc(2026, 8, 20))), "base")
})
