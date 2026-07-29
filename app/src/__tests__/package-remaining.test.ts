/**
 * Unit-тесты остатка занятий пакета и выбора абонемента к списанию (29.07.2026,
 * баг «полностью оплаченный пакет не находится авто-подбором»):
 *  - packageLessonsRemaining: остаток = totalLessons − израсходовано (>= 0);
 *  - pickChargeableSubscription: FIFO по остатку ЗАНЯТИЙ, а НЕ по balance —
 *    полностью оплаченный пакет (balance=0) с занятиями выбирается; исчерпанный
 *    пропускается; календарный — первый.
 *
 * Чистая логика без БД.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  packageLessonsRemaining,
  pickChargeableSubscription,
} from "../lib/subscriptions/package-remaining"

function pkg(id: string, startDate: string, totalLessons: number) {
  return { id, type: "package", startDate: new Date(startDate), totalLessons }
}

describe("packageLessonsRemaining", () => {
  it("остаток = total − израсходовано", () => {
    assert.equal(packageLessonsRemaining(8, 3), 5)
    assert.equal(packageLessonsRemaining(8, 0), 8)
  })
  it("перерасход не уходит в минус", () => {
    assert.equal(packageLessonsRemaining(8, 8), 0)
    assert.equal(packageLessonsRemaining(8, 10), 0)
  })
})

describe("pickChargeableSubscription", () => {
  it("полностью оплаченный пакет (balance=0) с занятиями выбирается", () => {
    const subs = [pkg("a", "2026-07-01", 8)] // consumed=0 → остаток 8
    const consumed = new Map<string, number>() // 0 списаний
    const picked = pickChargeableSubscription(subs, consumed)
    assert.equal(picked?.id, "a")
  })

  it("FIFO: из двух пакетов с остатком берётся самый старый", () => {
    const subs = [pkg("new", "2026-07-10", 8), pkg("old", "2026-07-01", 8)]
    const consumed = new Map<string, number>()
    const picked = pickChargeableSubscription(subs, consumed)
    assert.equal(picked?.id, "old")
  })

  it("исчерпанный пакет пропускается, берётся следующий с остатком", () => {
    const subs = [pkg("spent", "2026-07-01", 8), pkg("fresh", "2026-07-05", 8)]
    const consumed = new Map<string, number>([["spent", 8]]) // spent исчерпан
    const picked = pickChargeableSubscription(subs, consumed)
    assert.equal(picked?.id, "fresh")
  })

  it("все пакеты исчерпаны → null (уходит в разовое)", () => {
    const subs = [pkg("a", "2026-07-01", 8), pkg("b", "2026-07-05", 4)]
    const consumed = new Map<string, number>([
      ["a", 8],
      ["b", 4],
    ])
    assert.equal(pickChargeableSubscription(subs, consumed), null)
  })

  it("календарный/фиксированный: возвращается первый (остаток не считается)", () => {
    const subs = [
      { id: "cal", type: "calendar", startDate: new Date("2026-07-01"), totalLessons: 8 },
    ]
    const picked = pickChargeableSubscription(subs, new Map())
    assert.equal(picked?.id, "cal")
  })
})
