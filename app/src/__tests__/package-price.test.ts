import { test } from "node:test"
import assert from "node:assert/strict"
import { packageLessonPrice } from "../lib/subscriptions/package-price"

test("override пакета имеет приоритет над базовой ценой", () => {
  const dir = { lessonPrice: 500, packagePrices: { "tpl-8": 400 } }
  assert.equal(packageLessonPrice(dir, "tpl-8"), 400)
})

test("нет override для пакета → базовая цена", () => {
  const dir = { lessonPrice: 500, packagePrices: { "tpl-8": 400 } }
  assert.equal(packageLessonPrice(dir, "tpl-12"), 500)
})

test("нет packageTemplateId → базовая цена", () => {
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: null }, undefined), 500)
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: { "a": 1 } }, null), 500)
})

test("packagePrices null/пустой/невалидный → базовая цена", () => {
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: null }, "x"), 500)
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: {} }, "x"), 500)
})

test("ключ-сирота с отрицательным/нечисловым значением → базовая цена", () => {
  const dir = { lessonPrice: 500, packagePrices: { bad: -5, txt: "abc" } as unknown }
  assert.equal(packageLessonPrice(dir, "bad"), 500)
  assert.equal(packageLessonPrice(dir, "txt"), 500)
})

test("Decimal-как-строка базовая цена нормализуется", () => {
  assert.equal(packageLessonPrice({ lessonPrice: "500", packagePrices: null }, "x"), 500)
})

test("0 как валидное переопределение (бесплатный пакет)", () => {
  assert.equal(packageLessonPrice({ lessonPrice: 500, packagePrices: { free: 0 } }, "free"), 0)
})
