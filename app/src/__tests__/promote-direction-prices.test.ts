import { test } from "node:test"
import assert from "node:assert/strict"
import { planPromotions } from "../lib/cron/promote-direction-prices-plan"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
type Row = {
  id: string
  directionId: string
  effectiveFrom: Date
  appliedAt: Date | null
  deletedAt: Date | null
}
const v = (over: Partial<Row>): Row => ({
  id: "x",
  directionId: "d1",
  effectiveFrom: utc(2026, 9, 1),
  appliedAt: null,
  deletedAt: null,
  ...over,
})

test("due версия (effectiveFrom <= сегодня) попадает в план", () => {
  const plans = planPromotions([v({ id: "a" })], utc(2026, 9, 1))
  assert.equal(plans.length, 1)
  assert.equal(plans[0].winner.id, "a")
  assert.deepEqual(plans[0].appliedIds, ["a"])
})

test("будущая версия не промоутится", () => {
  const plans = planPromotions([v({ effectiveFrom: utc(2026, 10, 1) })], utc(2026, 9, 1))
  assert.equal(plans.length, 0)
})

test("несколько due на направление → победитель с макс. датой, applied все", () => {
  const rows = [
    v({ id: "a", effectiveFrom: utc(2026, 8, 1) }),
    v({ id: "b", effectiveFrom: utc(2026, 9, 1) }),
  ]
  const plans = planPromotions(rows, utc(2026, 9, 15))
  assert.equal(plans.length, 1)
  assert.equal(plans[0].winner.id, "b")
  assert.deepEqual([...plans[0].appliedIds].sort(), ["a", "b"])
})

test("applied и deleted версии исключаются", () => {
  const rows = [
    v({ id: "a", appliedAt: utc(2026, 9, 1) }),
    v({ id: "b", deletedAt: utc(2026, 9, 1) }),
  ]
  assert.equal(planPromotions(rows, utc(2026, 9, 15)).length, 0)
})

test("разные направления — отдельные планы", () => {
  const rows = [v({ id: "a", directionId: "d1" }), v({ id: "b", directionId: "d2" })]
  const plans = planPromotions(rows, utc(2026, 9, 15))
  assert.equal(plans.length, 2)
})
