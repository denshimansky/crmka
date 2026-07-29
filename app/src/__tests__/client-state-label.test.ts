/**
 * Регрессия бага #84: «Статус клиента» в обзвоне был пуст для целых категорий
 * (Потенциал/Лид/Архив/ЧС/Нецелевой), т.к. читался только clientStatus (NULL).
 * clientStateLabel комбинирует funnelStatus + clientStatus и всегда возвращает
 * непустую метку — единый источник правды со списком «Клиенты».
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { clientStateLabel } from "../lib/clients/state-label"

describe("clientStateLabel", () => {
  it("потенциал (clientStatus=NULL) → «Потенциал», не пусто", () => {
    assert.equal(clientStateLabel("potential", null), "Потенциал")
  })

  it("лид/новый (clientStatus=NULL) → «Лид»", () => {
    assert.equal(clientStateLabel("new", null), "Лид")
  })

  it("активный по work-status → «Активный»", () => {
    assert.equal(clientStateLabel("active_client", "active"), "Активный")
  })

  it("выбывший по work-status → «Выбывший»", () => {
    assert.equal(clientStateLabel("active_client", "churned"), "Выбывший")
  })

  it("архив имеет приоритет над work-status", () => {
    assert.equal(clientStateLabel("archived", "active"), "Архив")
  })

  it("чёрный список", () => {
    assert.equal(clientStateLabel("blacklisted", null), "Чёрный список")
  })

  it("нецелевой", () => {
    assert.equal(clientStateLabel("non_target", null), "Нецелевой")
  })

  it("всегда непустая метка (fallback «Лид»)", () => {
    assert.equal(clientStateLabel("new", null).length > 0, true)
  })
})
