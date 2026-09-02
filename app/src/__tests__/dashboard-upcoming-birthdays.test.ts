/**
 * Unit-тесты виджета дашборда «Дни рождения» — чистая часть без БД:
 * расчёт ближайшего ДР и попадания в окно.
 *
 * Продуктовое правило (02.09.2026): дети — из ВСЕЙ базы, кроме чёрного списка,
 * архива и нецелевых, окно 7 дней; сотрудники — окно 30 дней.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  upcomingBirthday,
  CHILD_WINDOW_DAYS,
  STAFF_WINDOW_DAYS,
  BIRTHDAY_EXCLUDED_FUNNEL_STATUSES,
} from "../lib/dashboard/upcoming-birthdays"

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

describe("окна виджета «Дни рождения»", () => {
  it("детям — неделя, сотрудникам — месяц", () => {
    assert.equal(CHILD_WINDOW_DAYS, 7)
    assert.equal(STAFF_WINDOW_DAYS, 30)
  })

  it("исключаются ровно три базы: ЧС, архив, нецелевые", () => {
    assert.deepEqual([...BIRTHDAY_EXCLUDED_FUNNEL_STATUSES].sort(), [
      "archived",
      "blacklisted",
      "non_target",
    ])
  })
})

describe("upcomingBirthday", () => {
  const today = d(2026, 9, 2)

  it("день рождения сегодня — 0 дней до, попадает в окно", () => {
    const u = upcomingBirthday(d(2019, 9, 2), today, CHILD_WINDOW_DAYS)
    assert.ok(u)
    assert.equal(u.daysUntil, 0)
    assert.equal(u.turns, 7)
    assert.deepEqual(u.date, d(2026, 9, 2))
  })

  it("ровно на границе окна (7-й день) — попадает", () => {
    const u = upcomingBirthday(d(2020, 9, 9), today, CHILD_WINDOW_DAYS)
    assert.ok(u)
    assert.equal(u.daysUntil, 7)
    assert.equal(u.turns, 6)
  })

  it("на день дальше границы — не попадает детям, но попадает сотрудникам", () => {
    const birth = d(1990, 9, 10)
    assert.equal(upcomingBirthday(birth, today, CHILD_WINDOW_DAYS), null)
    const staff = upcomingBirthday(birth, today, STAFF_WINDOW_DAYS)
    assert.ok(staff)
    assert.equal(staff.daysUntil, 8)
    assert.equal(staff.turns, 36)
  })

  it("вчерашний ДР уезжает на следующий год и выпадает из окна", () => {
    assert.equal(upcomingBirthday(d(2018, 9, 1), today, CHILD_WINDOW_DAYS), null)
    assert.equal(upcomingBirthday(d(2018, 9, 1), today, STAFF_WINDOW_DAYS), null)
  })

  it("окно переходит через Новый год", () => {
    const u = upcomingBirthday(d(2021, 1, 3), d(2026, 12, 28), CHILD_WINDOW_DAYS)
    assert.ok(u)
    assert.equal(u.daysUntil, 6)
    assert.deepEqual(u.date, d(2027, 1, 3))
    // На ДР 03.01.2027 ребёнку 2021 года рождения исполнится 6
    assert.equal(u.turns, 6)
  })

  it("29 февраля в невисокосный год считается как 1 марта", () => {
    const u = upcomingBirthday(d(2020, 2, 29), d(2027, 2, 26), CHILD_WINDOW_DAYS)
    assert.ok(u)
    assert.deepEqual(u.date, d(2027, 3, 1))
    assert.equal(u.daysUntil, 3)
    assert.equal(u.turns, 7)
  })

  it("в високосный год 29 февраля остаётся собой", () => {
    const u = upcomingBirthday(d(2020, 2, 29), d(2028, 2, 26), CHILD_WINDOW_DAYS)
    assert.ok(u)
    assert.deepEqual(u.date, d(2028, 2, 29))
    assert.equal(u.daysUntil, 3)
    assert.equal(u.turns, 8)
  })
})
