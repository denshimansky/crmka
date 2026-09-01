import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  communicationAuthorLabel,
  employeeDisplayName,
  readCommunicationDevice,
} from "../lib/communications/author-label"

// Подпись автора в ленте коммуникаций. Смысл правила: строку, пришедшую из
// панели-расширения, подписывает РАБОЧЕЕ МЕСТО («ПК Филиал 1»), а не сотрудник,
// на которого выпущен токен, — токен раздаёт владелец, а за компьютером сидят
// администраторы смены. Ошибка здесь молча приписывает переписку не тому
// человеку, поэтому правило зафиксировано тестом.

describe("readCommunicationDevice", () => {
  it("берёт название рабочего места из metadata", () => {
    assert.equal(readCommunicationDevice({ source: "extension", device: "ПК Филиал 1" }), "ПК Филиал 1")
  })

  it("пустое и пробельное значение — как будто его нет", () => {
    assert.equal(readCommunicationDevice({ device: "" }), null)
    assert.equal(readCommunicationDevice({ device: "   " }), null)
  })

  it("обрезает пробелы по краям", () => {
    assert.equal(readCommunicationDevice({ device: "  ПК Филиал 2 " }), "ПК Филиал 2")
  })

  it("нестроковое значение игнорируется", () => {
    assert.equal(readCommunicationDevice({ device: 42 }), null)
    assert.equal(readCommunicationDevice({ device: { name: "ПК" } }), null)
  })

  it("metadata может быть чем угодно — null, массивом, строкой", () => {
    assert.equal(readCommunicationDevice(null), null)
    assert.equal(readCommunicationDevice(undefined), null)
    assert.equal(readCommunicationDevice([{ device: "ПК" }]), null)
    assert.equal(readCommunicationDevice("device"), null)
  })
})

describe("employeeDisplayName", () => {
  it("«Фамилия Имя» — как во всех лентах CRM", () => {
    assert.equal(employeeDisplayName({ firstName: "Анна", lastName: "Малафеева" }), "Малафеева Анна")
  })

  it("только имя — без лишнего пробела", () => {
    assert.equal(employeeDisplayName({ firstName: "Анна", lastName: null }), "Анна")
  })

  it("нет сотрудника или он безымянный — null", () => {
    assert.equal(employeeDisplayName(null), null)
    assert.equal(employeeDisplayName({ firstName: null, lastName: null }), null)
  })
})

describe("communicationAuthorLabel", () => {
  it("строка из панели: подписывает рабочее место, а не владелец токена", () => {
    assert.equal(
      communicationAuthorLabel(
        { source: "extension", device: "ПК Филиал 1" },
        { firstName: "Дмитрий", lastName: "Малафеев" },
      ),
      "ПК Филиал 1",
    )
  })

  it("заметка в CRM: подписывает сотрудник", () => {
    assert.equal(
      communicationAuthorLabel(null, { firstName: "Анна", lastName: "Малафеева" }),
      "Малафеева Анна",
    )
  })

  it("строки расширения до 01.09.2026 (device ещё не писали) — прежняя подпись сотрудником", () => {
    assert.equal(
      communicationAuthorLabel(
        { source: "extension", chatId: "79991234567" },
        { firstName: "Дмитрий", lastName: "Малафеев" },
      ),
      "Малафеев Дмитрий",
    )
  })

  it("входящее сообщение клиента: автора нет — device у таких строк не пишется", () => {
    assert.equal(
      communicationAuthorLabel({ source: "extension", chatId: "79991234567" }, null),
      null,
    )
  })
})
