import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { statusSelectorOptions } from "../lib/clients/status-selector-options"

const values = (r: { options: { value: string }[] }) => r.options.map((o) => o.value)

describe("statusSelectorOptions", () => {
  it("никогда не клиент — режим funnel, есть Потенциальный", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: false, clientStatus: null })
    assert.equal(r.mode, "funnel")
    assert.deepEqual(values(r), ["new", "potential", "non_target", "blacklisted", "archived"])
  })

  it("активный сейчас — режим transition: Выбывшие/Архив/ЧС", () => {
    const r = statusSelectorOptions({ isActiveClient: true, wasEverClient: true, clientStatus: "active" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["churned", "archived", "blacklisted"])
  })

  it("активный по абонементу, но clientStatus=churned — есть Вернуть в Активные, нет повторных Выбывших", () => {
    const r = statusSelectorOptions({ isActiveClient: true, wasEverClient: true, clientStatus: "churned" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["active", "archived", "blacklisted"])
  })

  it("бывший клиент, не активный, не churned — Выбывшие + Лид/Не целевой/ЧС/Архив, без Потенциального", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: true, clientStatus: null })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["churned", "new", "non_target", "blacklisted", "archived"])
    assert.equal(values(r).includes("potential"), false)
  })

  it("бывший клиент, выбывший — Вернуть в Активные вместо Выбывших", () => {
    const r = statusSelectorOptions({ isActiveClient: false, wasEverClient: true, clientStatus: "churned" })
    assert.equal(r.mode, "transition")
    assert.deepEqual(values(r), ["active", "new", "non_target", "blacklisted", "archived"])
  })
})
