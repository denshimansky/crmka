import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildSelectorConfig } from "../lib/ext/selector-config"

// Этот конфиг правят В АВАРИИ: канал в мессенджере сломался, и селектор дописывают
// руками, чтобы не ждать ревью Chrome Web Store. Тест держит форму ответа, чтобы
// спешка не превратилась во вторую аварию: расширение молча игнорирует значения
// не того типа, и «починка» выглядела бы применённой, ничего не изменив.

describe("buildSelectorConfig", () => {
  it("форма ответа та, которую разбирает расширение", () => {
    const config = buildSelectorConfig()
    assert.equal(typeof config.version, "number")
    assert.ok(config.version >= 1)
    assert.ok(!Number.isNaN(Date.parse(config.updatedAt)))
    assert.equal(typeof config.channels, "object")
    assert.equal(Array.isArray(config.channels), false)
  })

  it("каналы — только те, у которых есть адаптер", () => {
    for (const channel of Object.keys(buildSelectorConfig().channels)) {
      assert.ok(
        ["max", "telegram", "whatsapp"].includes(channel),
        `неизвестный канал: ${channel}`,
      )
    }
  })

  it("значения — непустая строка либо непустой список строк", () => {
    for (const [channel, selectors] of Object.entries(buildSelectorConfig().channels)) {
      for (const [key, value] of Object.entries(selectors ?? {})) {
        const where = `${channel}.${key}`
        if (Array.isArray(value)) {
          assert.ok(value.length > 0, `${where}: пустой список`)
          for (const item of value) {
            assert.equal(typeof item, "string", `${where}: не строка в списке`)
            assert.ok(item.trim().length > 0, `${where}: пустая строка в списке`)
          }
        } else {
          assert.equal(typeof value, "string", `${where}: не строка`)
          assert.ok(value.trim().length > 0, `${where}: пустое значение`)
        }
      }
    }
  })
})
