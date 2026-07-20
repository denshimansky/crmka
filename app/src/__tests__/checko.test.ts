/**
 * Unit-тесты разбора ответа checko.ru → официальное наименование заказчика
 * для «Счёт-договора оферты». Чистая функция legalNameFromResponse без сети.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { legalNameFromResponse } from "../lib/billing/checko"

describe("legalNameFromResponse — ИП (/entrepreneur)", () => {
  it("формирует «Индивидуальный предприниматель + ФИО»", () => {
    const r = legalNameFromResponse("entrepreneur", {
      ФИО: "Фирова Ольга Владимировна",
      Тип: "Индивидуальный предприниматель",
    })
    assert.deepEqual(r, {
      legalName: "Индивидуальный предприниматель Фирова Ольга Владимировна",
      kind: "ИП",
    })
  })

  it("использует дефолтный префикс, если Тип не пришёл", () => {
    const r = legalNameFromResponse("entrepreneur", { ФИО: "Иванов Иван Иванович" })
    assert.equal(r?.legalName, "Индивидуальный предприниматель Иванов Иван Иванович")
    assert.equal(r?.kind, "ИП")
  })

  it("тримит лишние пробелы в ФИО", () => {
    const r = legalNameFromResponse("entrepreneur", { ФИО: "  Петров Пётр  " })
    assert.equal(r?.legalName, "Индивидуальный предприниматель Петров Пётр")
  })

  it("без ФИО возвращает null", () => {
    assert.equal(legalNameFromResponse("entrepreneur", { ОГРНИП: "123" }), null)
  })
})

describe("legalNameFromResponse — ЮЛ (/company)", () => {
  it("предпочитает полное наименование (НаимПолн)", () => {
    const r = legalNameFromResponse("company", {
      НаимПолн: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "СБЕРБАНК РОССИИ"',
      НаимСокр: "ПАО СБЕРБАНК",
    })
    assert.deepEqual(r, {
      legalName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "СБЕРБАНК РОССИИ"',
      kind: "ЮЛ",
    })
  })

  it("падает на сокращённое, если полного нет", () => {
    const r = legalNameFromResponse("company", { НаимСокр: "ООО «Ромашка»" })
    assert.equal(r?.legalName, "ООО «Ромашка»")
    assert.equal(r?.kind, "ЮЛ")
  })

  it("без наименований возвращает null", () => {
    assert.equal(legalNameFromResponse("company", { ИНН: "7707083893" }), null)
  })
})

describe("legalNameFromResponse — пустой ответ", () => {
  it("пустой data:{} (не найдено) → null", () => {
    assert.equal(legalNameFromResponse("entrepreneur", {}), null)
    assert.equal(legalNameFromResponse("company", {}), null)
    assert.equal(legalNameFromResponse("company", null), null)
    assert.equal(legalNameFromResponse("company", undefined), null)
  })
})
