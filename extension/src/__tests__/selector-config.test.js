import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  mergeSelectors,
  parseSelectorConfig,
  readChannelOverrides,
} from "../common/selector-config.js"

// Конфиг приезжает по сети и попадает прямо в querySelectorAll. Значит проверять
// его надо как чужой ввод: механизм починки канала не должен становиться
// способом сломать его сильнее.

const DEFAULTS = {
  bubble: '[class*="messageWrapper"]',
  meta: '[class*="meta"]',
  title: ['[class*="chatHeader"] [class*="title"]', "header [class*=\"title\"]"],
}

describe("parseSelectorConfig", () => {
  it("нормальный ответ сервера", () => {
    const parsed = parseSelectorConfig({
      version: 3,
      updatedAt: "2026-08-31T00:00:00.000Z",
      channels: { max: { bubble: ".x" } },
    })
    assert.equal(parsed?.version, 3)
    assert.deepEqual(parsed?.channels, { max: { bubble: ".x" } })
  })

  it("пустые каналы — штатное состояние, а не поломка", () => {
    assert.deepEqual(parseSelectorConfig({ version: 1, channels: {} })?.channels, {})
  })

  it("не конфиг — отбрасываем целиком", () => {
    // Так выглядит страница логина или ответ прокси: половинчато принятый
    // конфиг хуже отсутствующего.
    assert.equal(parseSelectorConfig(null), null)
    assert.equal(parseSelectorConfig("<html>"), null)
    assert.equal(parseSelectorConfig({ version: 1 }), null)
    assert.equal(parseSelectorConfig({ channels: [] }), null)
  })
})

describe("readChannelOverrides", () => {
  it("берёт свой канал", () => {
    const cached = { channels: { max: { bubble: ".x" }, telegram: { bubble: ".y" } } }
    assert.deepEqual(readChannelOverrides(cached, "max"), { bubble: ".x" })
  })

  it("нет кэша или нет канала — пусто", () => {
    assert.deepEqual(readChannelOverrides(null, "max"), {})
    assert.deepEqual(readChannelOverrides({ channels: {} }, "max"), {})
    assert.deepEqual(readChannelOverrides({ channels: { max: "строка" } }, "max"), {})
  })
})

describe("mergeSelectors", () => {
  it("переопределение применяется", () => {
    const { selectors, applied } = mergeSelectors(DEFAULTS, { bubble: ".msg" })
    assert.equal(selectors.bubble, ".msg")
    assert.equal(selectors.meta, DEFAULTS.meta)
    assert.deepEqual(applied, ["bubble"])
  })

  it("встроенные значения не мутируются — конфиг применяется повторно", () => {
    mergeSelectors(DEFAULTS, { bubble: ".msg" })
    assert.equal(DEFAULTS.bubble, '[class*="messageWrapper"]')
    const второй = mergeSelectors(DEFAULTS, {})
    assert.equal(второй.selectors.bubble, '[class*="messageWrapper"]')
  })

  it("неизвестный ключ игнорируется и виден в отказах", () => {
    const { selectors, rejected } = mergeSelectors(DEFAULTS, { bubbles: ".msg" })
    assert.equal("bubbles" in selectors, false)
    assert.deepEqual(rejected, ["bubbles"])
  })

  it("тип обязан совпадать со встроенным", () => {
    const { selectors, rejected } = mergeSelectors(DEFAULTS, {
      bubble: [".a", ".b"],
      title: ".one",
    })
    assert.equal(selectors.bubble, DEFAULTS.bubble)
    assert.deepEqual(selectors.title, DEFAULTS.title)
    assert.deepEqual(rejected.sort(), ["bubble", "title"])
  })

  it("пустые и небуквенные значения не принимаем", () => {
    const { selectors } = mergeSelectors(DEFAULTS, { bubble: "   ", meta: 42, title: [] })
    assert.equal(selectors.bubble, DEFAULTS.bubble)
    assert.equal(selectors.meta, DEFAULTS.meta)
    assert.deepEqual(selectors.title, DEFAULTS.title)
  })

  // Главная защита: невалидный CSS в конфиге уронил бы разбор исключением.
  it("нерабочий селектор отклоняется проверкой разбора", () => {
    const isValid = (s) => !s.includes("[[")
    const { selectors, rejected } = mergeSelectors(DEFAULTS, { bubble: "[[broken" }, isValid)
    assert.equal(selectors.bubble, DEFAULTS.bubble)
    assert.deepEqual(rejected, ["bubble"])
  })

  it("список принимается целиком или не принимается вовсе — порядок в нём значим", () => {
    const isValid = (s) => !s.includes("[[")
    const { selectors } = mergeSelectors(DEFAULTS, { title: [".ok", "[[broken"] }, isValid)
    assert.deepEqual(selectors.title, DEFAULTS.title)
    const { selectors: good } = mergeSelectors(DEFAULTS, { title: [".a", ".b"] }, isValid)
    assert.deepEqual(good.title, [".a", ".b"])
  })

  it("пустой конфиг ничего не меняет", () => {
    const { selectors, applied, rejected } = mergeSelectors(DEFAULTS, {})
    assert.deepEqual(selectors, DEFAULTS)
    assert.deepEqual(applied, [])
    assert.deepEqual(rejected, [])
  })
})
