/**
 * Unit-тесты для effectiveRosterDate и логики состава перенесённого занятия.
 *
 * Баг: при переносе занятия `date` перезаписывалась новой датой, и состав
 * (Subscription.startDate <= date / enrolledAt <= date) считался по НОВОЙ дате —
 * ученик, начавший заниматься позже исходной даты, ошибочно попадал в занятие.
 * Фикс: состав считается по effectiveRosterDate = rescheduledFromDate ?? date.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  effectiveRosterDate,
  isEnrolledOnLesson,
} from "../lib/subscriptions/roster-filter"

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

// Повторяет решение «ребёнок в составе занятия» из карточки занятия:
// enrolledAt <= rosterDate ИЛИ есть абонемент с startDate <= rosterDate.
function isChildOnLesson(
  child: { enrolledAt: Date; startDate: Date | null },
  rosterDate: Date,
): boolean {
  if (child.enrolledAt <= rosterDate) return true
  if (child.startDate && child.startDate <= rosterDate) return true
  return false
}

describe("effectiveRosterDate", () => {
  it("возвращает rescheduledFromDate, когда занятие переносили", () => {
    const lesson = { date: d(2026, 6, 9), rescheduledFromDate: d(2026, 6, 4) }
    assert.equal(effectiveRosterDate(lesson).getTime(), d(2026, 6, 4).getTime())
  })

  it("возвращает date, когда занятие не переносили (null)", () => {
    const lesson = { date: d(2026, 6, 9), rescheduledFromDate: null }
    assert.equal(effectiveRosterDate(lesson).getTime(), d(2026, 6, 9).getTime())
  })

  it("возвращает date, когда поле не задано (undefined)", () => {
    const lesson = { date: d(2026, 6, 9) }
    assert.equal(effectiveRosterDate(lesson).getTime(), d(2026, 6, 9).getTime())
  })
})

describe("состав перенесённого занятия (баг с поздним стартом)", () => {
  // Сценарий из репорта: занятие 4-го перенесено на 9-е; ребёнок начал
  // заниматься 8-го (абонемент и зачисление с 8-го).
  const lesson = { date: d(2026, 6, 9), rescheduledFromDate: d(2026, 6, 4) }
  const lateChild = { enrolledAt: d(2026, 6, 8), startDate: d(2026, 6, 8) }
  const oldChild = { enrolledAt: d(2026, 6, 1), startDate: d(2026, 6, 1) }

  it("ученик с поздним стартом НЕ попадает в перенесённое занятие", () => {
    assert.equal(isChildOnLesson(lateChild, effectiveRosterDate(lesson)), false)
  })

  it("(демонстрация бага) по НОВОЙ дате он бы ошибочно попал", () => {
    assert.equal(isChildOnLesson(lateChild, lesson.date), true)
  })

  it("ученик группы с ранним стартом остаётся в составе", () => {
    assert.equal(isChildOnLesson(oldChild, effectiveRosterDate(lesson)), true)
  })

  it("без переноса (rescheduledFromDate=null) поздний ученик в занятии 9-го есть", () => {
    const sameDay = { date: d(2026, 6, 9), rescheduledFromDate: null }
    assert.equal(isChildOnLesson(lateChild, effectiveRosterDate(sameDay)), true)
  })
})

describe("isEnrolledOnLesson по исходной дате", () => {
  const rosterDate = effectiveRosterDate({
    date: d(2026, 6, 9),
    rescheduledFromDate: d(2026, 6, 4),
  })

  it("зачисленный позже исходной даты — не в составе", () => {
    assert.equal(
      isEnrolledOnLesson({ enrolledAt: d(2026, 6, 8), withdrawnAt: null }, rosterDate),
      false,
    )
  })

  it("зачисленный до исходной даты — в составе", () => {
    assert.equal(
      isEnrolledOnLesson({ enrolledAt: d(2026, 6, 1), withdrawnAt: null }, rosterDate),
      true,
    )
  })

  it("выбывший после исходной даты (граница withdrawnAt > date) — в составе", () => {
    assert.equal(
      isEnrolledOnLesson({ enrolledAt: d(2026, 6, 1), withdrawnAt: d(2026, 6, 6) }, rosterDate),
      true,
    )
  })
})
