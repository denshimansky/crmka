import { test } from "node:test"
import assert from "node:assert/strict"
import { directionPriceAt, dayNumUtc, toUtcDay } from "../lib/subscriptions/direction-price"
import { packageLessonPrice } from "../lib/subscriptions/package-price"

const base = {
  lessonPrice: 400,
  trialPrice: 500,
  trialFree: false,
  singleVisitPrice: 600,
  packagePrices: { "tpl-8": 380 },
}
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

test("нет версий → базовая цена", () => {
  assert.equal(directionPriceAt(base, [], utc(2026, 9, 1)).lessonPrice, 400)
  assert.equal(directionPriceAt(base, null, utc(2026, 9, 1)).lessonPrice, 400)
})

test("atDate до границы → база (старая ставка)", () => {
  const versions = [{ effectiveFrom: utc(2026, 9, 1), lessonPrice: 450 }]
  assert.equal(directionPriceAt(base, versions, utc(2026, 8, 25)).lessonPrice, 400)
})

test("atDate на границе (inclusive) → версия (новая ставка)", () => {
  const versions = [{ effectiveFrom: utc(2026, 9, 1), lessonPrice: 450 }]
  assert.equal(directionPriceAt(base, versions, utc(2026, 9, 1)).lessonPrice, 450)
})

test("atDate после границы → версия", () => {
  const versions = [{ effectiveFrom: utc(2026, 9, 1), lessonPrice: 450 }]
  assert.equal(directionPriceAt(base, versions, utc(2026, 9, 15)).lessonPrice, 450)
})

test("несколько версий → ближайшая слева от atDate", () => {
  const versions = [
    { effectiveFrom: utc(2026, 9, 1), lessonPrice: 450 },
    { effectiveFrom: utc(2027, 1, 1), lessonPrice: 550 },
  ]
  assert.equal(directionPriceAt(base, versions, utc(2026, 12, 31)).lessonPrice, 450)
  assert.equal(directionPriceAt(base, versions, utc(2027, 1, 1)).lessonPrice, 550)
  assert.equal(directionPriceAt(base, versions, utc(2026, 8, 1)).lessonPrice, 400)
})

test("удалённая версия игнорируется", () => {
  const versions = [
    { effectiveFrom: utc(2026, 9, 1), lessonPrice: 450, deletedAt: utc(2026, 8, 1) },
  ]
  assert.equal(directionPriceAt(base, versions, utc(2026, 9, 5)).lessonPrice, 400)
})

test("промоутнутая (applied) версия игнорируется — база уже содержит её значение", () => {
  const versions = [
    { effectiveFrom: utc(2026, 9, 1), lessonPrice: 450, appliedAt: utc(2026, 9, 1) },
  ]
  assert.equal(directionPriceAt(base, versions, utc(2026, 9, 5)).lessonPrice, 400)
})

test("резолвит все четыре цены из версии", () => {
  const versions = [
    {
      effectiveFrom: utc(2026, 9, 1),
      lessonPrice: 450,
      trialPrice: 550,
      trialFree: true,
      singleVisitPrice: 700,
      packagePrices: { "tpl-8": 420 },
    },
  ]
  const r = directionPriceAt(base, versions, utc(2026, 9, 2))
  assert.equal(r.lessonPrice, 450)
  assert.equal(r.trialPrice, 550)
  assert.equal(r.trialFree, true)
  assert.equal(r.singleVisitPrice, 700)
  assert.deepEqual(r.packagePrices, { "tpl-8": 420 })
})

test("композиция с packageLessonPrice — пакетная цена из версии", () => {
  const versions = [
    { effectiveFrom: utc(2026, 9, 1), lessonPrice: 450, packagePrices: { "tpl-8": 420 } },
  ]
  const resolved = directionPriceAt(base, versions, utc(2026, 9, 2))
  assert.equal(packageLessonPrice(resolved, "tpl-8"), 420) // пакетный оверрайд версии
  assert.equal(packageLessonPrice(resolved, "tpl-12"), 450) // нет оверрайда → цена занятия версии
})

test("toUtcDay: локальный календарный день → UTC-полночь того же дня (TZ-стабильно)", () => {
  const local = new Date(2026, 8, 1) // 1 сентября, локальная полночь
  assert.equal(dayNumUtc(toUtcDay(local)), Date.UTC(2026, 8, 1))
})

test("Decimal-подобные значения (toString) нормализуются в число", () => {
  const dec = { toString: () => "450.50" }
  const versions = [{ effectiveFrom: utc(2026, 9, 1), lessonPrice: dec }]
  assert.equal(directionPriceAt(base, versions, utc(2026, 9, 2)).lessonPrice, 450.5)
})
