/**
 * Unit-тесты расчёта/форматирования возраста (годы + месяцы): границы месяца,
 * младенцы младше года, склонение «год/года/лет», пустая/будущая дата.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ageYearsMonths, ageYears, formatAge } from "../lib/age"

const NOW = new Date("2026-08-10T12:00:00.000Z")

describe("ageYearsMonths", () => {
  it("считает полные годы и месяцы", () => {
    assert.deepEqual(ageYearsMonths("2018-05-03", NOW), { years: 8, months: 3 })
  })
  it("месяц не полный, если число ещё не наступило", () => {
    // ДР 15-го, сегодня 10-е → последний месяц не засчитан.
    assert.deepEqual(ageYearsMonths("2025-08-15", NOW), { years: 0, months: 11 })
  })
  it("ровно N лет — 0 месяцев", () => {
    assert.deepEqual(ageYearsMonths("2024-08-10", NOW), { years: 2, months: 0 })
  })
  it("младенец младше года", () => {
    // Dec 15 → Aug 10: 7 полных месяцев (15-е число ещё не наступило).
    assert.deepEqual(ageYearsMonths("2025-12-15", NOW), { years: 0, months: 7 })
  })
  it("null для пустой, некорректной и будущей даты", () => {
    assert.equal(ageYearsMonths(null, NOW), null)
    assert.equal(ageYearsMonths("не дата", NOW), null)
    assert.equal(ageYearsMonths("2027-01-01", NOW), null)
  })
})

describe("ageYears — целые годы для сортировки/фильтров", () => {
  it("совпадает с годами из ageYearsMonths", () => {
    assert.equal(ageYears("2018-05-03", NOW), 8)
    assert.equal(ageYears("2025-08-15", NOW), 0)
    assert.equal(ageYears(null, NOW), null)
  })
})

describe("formatAge — метка с месяцами и склонением", () => {
  it("годы + месяцы", () => {
    assert.equal(formatAge("2018-05-03", NOW), "8 лет 3 мес.")
    assert.equal(formatAge("2024-05-10", NOW), "2 года 3 мес.")
    assert.equal(formatAge("2025-05-10", NOW), "1 год 3 мес.")
  })
  it("ровно N лет — без «0 мес.»", () => {
    assert.equal(formatAge("2024-08-10", NOW), "2 года")
    assert.equal(formatAge("2025-08-10", NOW), "1 год")
    assert.equal(formatAge("2021-08-10", NOW), "5 лет")
  })
  it("только месяцы для младенца", () => {
    assert.equal(formatAge("2025-12-15", NOW), "7 мес.")
    assert.equal(formatAge("2026-08-01", NOW), "0 мес.")
  })
  it("плейсхолдер для пустой/будущей даты", () => {
    assert.equal(formatAge(null, NOW), "—")
    assert.equal(formatAge("2027-01-01", NOW), "—")
    assert.equal(formatAge(null, NOW, "нет данных"), "нет данных")
  })
})
