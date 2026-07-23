/**
 * Unit-тесты валидации ставок ЗП (rate-schema.ts).
 * 10.07.2026: матрица floating обязана покрывать все количества детей от 1 —
 * иначе занятия ниже минимального порога молча дают инструктору 0₽ (кейс Dream:
 * брекеты от 3, занятия с 1–2 детьми — без начисления).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { validateForScheme } from "../lib/salary/rate-schema"

function floating(brackets: { minStudents: number; ratePerLesson: number }[]) {
  return { scheme: "floating_by_students" as const, brackets }
}

describe("validateForScheme: floating_by_students — покрытие матрицы", () => {
  it("матрица от 1 — валидна", () => {
    assert.equal(validateForScheme(floating([
      { minStudents: 1, ratePerLesson: 120 },
      { minStudents: 3, ratePerLesson: 360 },
    ])), null)
  })

  it("ставка 0 для 1 ребёнка — валидный явный выбор владельца", () => {
    assert.equal(validateForScheme(floating([
      { minStudents: 1, ratePerLesson: 0 },
      { minStudents: 3, ratePerLesson: 360 },
    ])), null)
  })

  it("матрица от 3 — ошибка с перечислением непокрытых количеств", () => {
    const err = validateForScheme(floating([{ minStudents: 3, ratePerLesson: 360 }]))
    assert.match(err ?? "", /1–2 детей/)
  })

  it("матрица от 2 — ошибка про 1 ребёнка", () => {
    const err = validateForScheme(floating([{ minStudents: 2, ratePerLesson: 240 }]))
    assert.match(err ?? "", /1 ребёнка/)
  })

  it("пустая матрица — ошибка", () => {
    assert.notEqual(validateForScheme(floating([])), null)
  })

  it("дубль порога — ошибка", () => {
    const err = validateForScheme(floating([
      { minStudents: 1, ratePerLesson: 100 },
      { minStudents: 3, ratePerLesson: 300 },
      { minStudents: 3, ratePerLesson: 360 },
    ]))
    assert.match(err ?? "", /дубль/)
  })
})
