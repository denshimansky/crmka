import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseBubbleTitleDate } from "../common/telegram-time.js"

// Подсказка у времени — единственное место, откуда вообще можно узнать, когда
// сообщение отправлено (машинного времени в разметке Telegram нет). Если разбор
// сломается, вся переписка ляжет в CRM временем заливки — и лента коммуникаций
// перестанет отражать реальный порядок разговора.

/** Ожидаемый ISO для местного времени: тесты не должны зависеть от зоны машины. */
function localIso(y, m, d, hh, mm, ss = 0) {
  return new Date(y, m - 1, d, hh, mm, ss).toISOString()
}

describe("parseBubbleTitleDate — месяц словом", () => {
  it("русский интерфейс", () => {
    assert.equal(
      parseBubbleTitleDate("28 августа 2026, 10:14:31"),
      localIso(2026, 8, 28, 10, 14, 31),
    )
  })
  it("английский интерфейс", () => {
    assert.equal(
      parseBubbleTitleDate("3 January 2024, 14:05:30"),
      localIso(2024, 1, 3, 14, 5, 30),
    )
  })
  it("май в именительном падеже", () => {
    assert.equal(parseBubbleTitleDate("1 май 2026, 09:00:00"), localIso(2026, 5, 1, 9, 0, 0))
  })
  it("день с ведущим нулём", () => {
    assert.equal(parseBubbleTitleDate("03 марта 2026, 08:07:06"), localIso(2026, 3, 3, 8, 7, 6))
  })
  it("без секунд", () => {
    assert.equal(parseBubbleTitleDate("28 августа 2026, 10:14"), localIso(2026, 8, 28, 10, 14))
  })
})

describe("parseBubbleTitleDate — месяц числом", () => {
  it("полный формат", () => {
    assert.equal(parseBubbleTitleDate("28.08.2026, 10:14:31"), localIso(2026, 8, 28, 10, 14, 31))
  })
  it("двузначный год — это 20xx", () => {
    assert.equal(parseBubbleTitleDate("28.08.26, 10:14:31"), localIso(2026, 8, 28, 10, 14, 31))
  })
})

describe("parseBubbleTitleDate — многострочная подсказка", () => {
  it("берём первую строку: время отправки, а не правки", () => {
    assert.equal(
      parseBubbleTitleDate("28 августа 2026, 10:14:31\nEdited: 28 августа 2026, 11:00:00"),
      localIso(2026, 8, 28, 10, 14, 31),
    )
  })
  it("пересланное: «Original» ниже игнорируем", () => {
    assert.equal(
      parseBubbleTitleDate("28 августа 2026, 10:14:31\nOriginal: 1 июля 2026, 08:00:00"),
      localIso(2026, 8, 28, 10, 14, 31),
    )
  })
})

describe("parseBubbleTitleDate — мусор не выдумываем", () => {
  it("пусто", () => {
    assert.equal(parseBubbleTitleDate(""), null)
  })
  it("null", () => {
    assert.equal(parseBubbleTitleDate(null), null)
  })
  it("только время без даты", () => {
    assert.equal(parseBubbleTitleDate("10:14"), null)
  })
  it("неизвестный месяц", () => {
    assert.equal(parseBubbleTitleDate("28 бармаглота 2026, 10:14:31"), null)
  })
  it("несуществующая дата", () => {
    assert.equal(parseBubbleTitleDate("31.02.2026, 10:14:31"), null)
  })
  it("невозможное время", () => {
    assert.equal(parseBubbleTitleDate("28.08.2026, 25:14:31"), null)
  })
})
