/**
 * Раскладка минусового баланса клиента на источники долга и подписи к ним.
 * Фикс: импортированный долг помечается «долг после импорта» (а не
 * «перенос/закрытие»), а вся строка — долг, поэтому показывается со знаком «−».
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { splitBalanceDebt, balanceDebtLabels } from "../lib/one-off-debt"

describe("splitBalanceDebt", () => {
  it("чистый импортный долг → весь в imported, подпись «долг после импорта»", () => {
    const b = splitBalanceDebt(1100, 0, -1100)
    assert.deepEqual(b, { oneOff: 0, imported: 1100, other: 0 })
    assert.deepEqual(balanceDebtLabels(b), ["долг после импорта"])
  })

  it("разовые + импорт", () => {
    const b = splitBalanceDebt(1300, 200, -1100)
    assert.deepEqual(b, { oneOff: 200, imported: 1100, other: 0 })
    assert.deepEqual(balanceDebtLabels(b), ["разовые посещения", "долг после импорта"])
  })

  it("импорт с кредитом (importNet > 0) не создаёт долга → остаток в «перенос/закрытие»", () => {
    const b = splitBalanceDebt(500, 0, 300)
    assert.deepEqual(b, { oneOff: 0, imported: 0, other: 500 })
    assert.deepEqual(balanceDebtLabels(b), ["перенос/закрытие"])
  })

  it("импорт клампится к остатку после разовых", () => {
    const b = splitBalanceDebt(1000, 900, -1100)
    assert.deepEqual(b, { oneOff: 900, imported: 100, other: 0 })
  })

  it("все три источника сразу", () => {
    const b = splitBalanceDebt(1000, 300, -400)
    assert.deepEqual(b, { oneOff: 300, imported: 400, other: 300 })
    assert.deepEqual(balanceDebtLabels(b), [
      "разовые посещения",
      "долг после импорта",
      "перенос/закрытие",
    ])
  })

  it("нет долга → пустая раскладка и пустые подписи", () => {
    const b = splitBalanceDebt(0, 0, 0)
    assert.deepEqual(b, { oneOff: 0, imported: 0, other: 0 })
    assert.deepEqual(balanceDebtLabels(b), [])
  })
})
