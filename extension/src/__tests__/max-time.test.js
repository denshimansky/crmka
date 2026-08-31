import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildMessageSentAt, parseCapsuleDate, parseClock } from "../common/max-time.js"

// Время в MAX собирается из двух половин разметки: часы лежат в пузыре, дата —
// в капсуле-разделителе выше. Машинного времени нет вовсе, поэтому разбор строк
// и есть единственный источник — и он под тестами.

// Фиксированный «сейчас»: 15 июля 2026, среда. Без него «Сегодня» и «Вчера»
// проверить нельзя, а тест стал бы зависеть от дня прогона.
const NOW = new Date(2026, 6, 15, 12, 0, 0)

describe("parseCapsuleDate", () => {
  it("полная дата с годом — основной случай MAX", () => {
    assert.deepEqual(parseCapsuleDate("2 июля 2026", NOW), { year: 2026, month: 6, day: 2 })
  })
  it("другой месяц", () => {
    assert.deepEqual(parseCapsuleDate("16 июня 2026", NOW), { year: 2026, month: 5, day: 16 })
  })
  it("«Сегодня»", () => {
    assert.deepEqual(parseCapsuleDate("Сегодня", NOW), { year: 2026, month: 6, day: 15 })
  })
  it("«Вчера»", () => {
    assert.deepEqual(parseCapsuleDate("Вчера", NOW), { year: 2026, month: 6, day: 14 })
  })
  it("«Вчера» через границу месяца", () => {
    const первоеИюля = new Date(2026, 6, 1, 9, 0, 0)
    assert.deepEqual(parseCapsuleDate("Вчера", первоеИюля), { year: 2026, month: 5, day: 30 })
  })
  it("регистр не важен", () => {
    assert.deepEqual(parseCapsuleDate("сегодня", NOW), parseCapsuleDate("Сегодня", NOW))
  })
  it("без года — считаем текущим", () => {
    assert.deepEqual(parseCapsuleDate("2 июля", NOW), { year: 2026, month: 6, day: 2 })
  })
  it("склонение месяца не мешает: хватает трёх букв", () => {
    assert.deepEqual(parseCapsuleDate("5 март 2026", NOW), parseCapsuleDate("5 марта 2026", NOW))
  })
  it("несуществующая дата — не выдумываем", () => {
    // JS молча переносит «31 февраля» на март, поэтому проверяем явно.
    assert.equal(parseCapsuleDate("31 февраля 2026", NOW), null)
  })
  it("мусор", () => {
    assert.equal(parseCapsuleDate("Отменённый вызов", NOW), null)
    assert.equal(parseCapsuleDate("", NOW), null)
    assert.equal(parseCapsuleDate(null, NOW), null)
  })
})

describe("parseClock", () => {
  it("часы из .meta", () => {
    assert.deepEqual(parseClock("16:15"), { hours: 16, minutes: 15 })
  })
  it("рядом могут быть галочки доставки", () => {
    assert.deepEqual(parseClock("13:03 ✓✓"), { hours: 13, minutes: 3 })
  })
  it("невозможное время", () => {
    assert.equal(parseClock("25:00"), null)
    assert.equal(parseClock("12:70"), null)
  })
  it("часов нет", () => {
    assert.equal(parseClock("Скачать • 143.85 KB"), null)
    assert.equal(parseClock(null), null)
  })
})

describe("buildMessageSentAt", () => {
  it("капсула плюс часы дают время сообщения", () => {
    const iso = buildMessageSentAt({ capsule: "2 июля 2026", clock: "16:15", now: NOW })
    assert.ok(iso, "время должно собраться")
    const d = new Date(iso)
    // Время местное — то же, что видит человек.
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 6)
    assert.equal(d.getDate(), 2)
    assert.equal(d.getHours(), 16)
    assert.equal(d.getMinutes(), 15)
  })
  it("«Сегодня» тоже работает", () => {
    const iso = buildMessageSentAt({ capsule: "Сегодня", clock: "09:05", now: NOW })
    assert.ok(iso, "время должно собраться")
    const d = new Date(iso)
    assert.equal(d.getDate(), 15)
    assert.equal(d.getHours(), 9)
  })
  it("без даты время не собираем", () => {
    // «Когда-то в 16:15» ставить в ленту коммуникаций нельзя — пусть время
    // проставит сервер.
    assert.equal(buildMessageSentAt({ capsule: null, clock: "16:15", now: NOW }), null)
  })
  it("без часов тоже", () => {
    assert.equal(buildMessageSentAt({ capsule: "2 июля 2026", clock: null, now: NOW }), null)
  })
})
