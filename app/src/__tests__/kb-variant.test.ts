/**
 * Вкладки базы знаний: отображение типа абонемента → вкладку.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  KB_VARIANTS,
  KB_VARIANT_LABELS,
  isKbVariant,
  kbVariantForSubscriptionType,
} from "../lib/kb-variant"

describe("kb-variant: тип абонемента → вкладка", () => {
  it("package → «Пакетный»", () => {
    assert.equal(kbVariantForSubscriptionType("package"), "package")
  })

  it("calendar / fixed / null / undefined → «Календарный»", () => {
    assert.equal(kbVariantForSubscriptionType("calendar"), "calendar")
    assert.equal(kbVariantForSubscriptionType("fixed"), "calendar")
    assert.equal(kbVariantForSubscriptionType(null), "calendar")
    assert.equal(kbVariantForSubscriptionType(undefined), "calendar")
  })

  it("две вкладки с русскими подписями", () => {
    assert.deepEqual([...KB_VARIANTS], ["calendar", "package"])
    assert.equal(KB_VARIANT_LABELS.calendar, "Календарный")
    assert.equal(KB_VARIANT_LABELS.package, "Пакетный")
  })

  it("isKbVariant валидирует строку", () => {
    assert.equal(isKbVariant("calendar"), true)
    assert.equal(isKbVariant("package"), true)
    assert.equal(isKbVariant("fixed"), false)
    assert.equal(isKbVariant(""), false)
    assert.equal(isKbVariant(null), false)
    assert.equal(isKbVariant(42), false)
  })
})
