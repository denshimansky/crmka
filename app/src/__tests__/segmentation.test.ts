/**
 * Unit-тесты для lib/segmentation (баг #26).
 * Чистая логика без БД: расчёт сегмента, ручное переопределение, подписи порогов.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computeSegment,
  effectiveSegment,
  monthsSince,
  parseSegmentationConfig,
  segmentRangeLabel,
  type SegmentationConfig,
} from "../lib/segmentation"

const AMOUNT: SegmentationConfig = {
  mode: "amount",
  thresholds: { standard: 50000, regular: 200000, vip: 500000 },
}
const MONTHS: SegmentationConfig = {
  mode: "months",
  thresholds: { standard: 1, regular: 6, vip: 12 },
}

describe("parseSegmentationConfig", () => {
  it("парсит валидный amount-конфиг", () => {
    const c = parseSegmentationConfig({ mode: "amount", thresholds: { standard: 1, regular: 2, vip: 3 } })
    assert.deepEqual(c, { mode: "amount", thresholds: { standard: 1, regular: 2, vip: 3 } })
  })

  it("возвращает null для мусора", () => {
    assert.equal(parseSegmentationConfig(null), null)
    assert.equal(parseSegmentationConfig({}), null)
    assert.equal(parseSegmentationConfig({ mode: "weeks", thresholds: { standard: 1, regular: 2, vip: 3 } }), null)
    assert.equal(parseSegmentationConfig({ mode: "amount", thresholds: { standard: -1, regular: 2, vip: 3 } }), null)
    assert.equal(parseSegmentationConfig({ mode: "amount" }), null)
  })
})

describe("computeSegment", () => {
  it("бакетирует по порогам (amount)", () => {
    assert.equal(computeSegment(0, AMOUNT), "new_client")
    assert.equal(computeSegment(49999, AMOUNT), "new_client")
    assert.equal(computeSegment(50000, AMOUNT), "standard")
    assert.equal(computeSegment(199999, AMOUNT), "standard")
    assert.equal(computeSegment(200000, AMOUNT), "regular")
    assert.equal(computeSegment(500000, AMOUNT), "vip")
    assert.equal(computeSegment(999999, AMOUNT), "vip")
  })

  it("без конфига и при некорректной метрике — Новый", () => {
    assert.equal(computeSegment(1000000, null), "new_client")
    assert.equal(computeSegment(NaN, AMOUNT), "new_client")
    assert.equal(computeSegment(-5, AMOUNT), "new_client")
  })
})

describe("effectiveSegment", () => {
  it("ручное переопределение побеждает авто", () => {
    assert.equal(effectiveSegment("vip", "new_client"), "vip")
    assert.equal(effectiveSegment("new_client", "vip"), "new_client")
  })

  it("без переопределения берётся авто", () => {
    assert.equal(effectiveSegment(null, "regular"), "regular")
    assert.equal(effectiveSegment(undefined, "standard"), "standard")
  })
})

describe("segmentRangeLabel", () => {
  // Intl.NumberFormat("ru-RU") разделяет тысячи неразрывным пробелом — нормализуем
  // любые пробелы в обычный, чтобы сравнение не зависело от версии ICU.
  const norm = (s: string) => s.replace(/\s/g, " ")

  it("показывает пороги для amount", () => {
    assert.equal(norm(segmentRangeLabel("new_client", AMOUNT)), "Новый (< 50 000 ₽)")
    assert.equal(norm(segmentRangeLabel("standard", AMOUNT)), "Стандартный (≥ 50 000 ₽)")
    assert.equal(norm(segmentRangeLabel("vip", AMOUNT)), "VIP (≥ 500 000 ₽)")
  })

  it("показывает пороги для months", () => {
    assert.equal(norm(segmentRangeLabel("regular", MONTHS)), "Постоянный (≥ 6 мес.)")
  })

  it("без конфига — только название", () => {
    assert.equal(segmentRangeLabel("vip", null), "VIP")
  })
})

describe("monthsSince", () => {
  it("null/будущее → 0", () => {
    assert.equal(monthsSince(null), 0)
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    assert.equal(monthsSince(future, new Date()), 0)
  })

  it("~12 месяцев назад → около 12", () => {
    const now = new Date("2026-06-19T00:00:00Z")
    const yearAgo = new Date("2025-06-19T00:00:00Z")
    const m = monthsSince(yearAgo, now)
    assert.ok(m >= 11.8 && m <= 12.2, `ожидали ~12, получили ${m}`)
  })
})
