import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { latestDate, ACTIVE_ENGAGEMENT_WINDOW_DAYS } from "../lib/clients/active-engagement"

describe("latestDate (крон оттока: последнее платное событие)", () => {
  it("пустой список / только null → null", () => {
    assert.equal(latestDate([]), null)
    assert.equal(latestDate([null, undefined, null]), null)
  })

  it("берёт самую позднюю дату", () => {
    const r = latestDate([
      new Date("2026-01-10"),
      new Date("2026-07-01"),
      new Date("2026-03-15"),
    ])
    assert.equal(r?.toISOString(), new Date("2026-07-01").toISOString())
  })

  it("игнорирует null/undefined среди дат", () => {
    const r = latestDate([null, new Date("2026-05-20"), undefined])
    assert.equal(r?.toISOString(), new Date("2026-05-20").toISOString())
  })

  it("платное занятие позже последнего абонемента → берётся дата занятия", () => {
    // subLastDate (абонементы) vs дата последнего платного занятия
    const subLast = new Date("2026-06-01")
    const lastPaidLesson = new Date("2026-07-20")
    assert.equal(
      latestDate([subLast, lastPaidLesson])?.toISOString(),
      lastPaidLesson.toISOString(),
    )
  })

  it("клиент без платных событий (оба null) → null → крон не трогает", () => {
    const subLast = null // нет абонементов
    const lastPaidLesson = null // нет платных занятий
    assert.equal(latestDate([subLast, lastPaidLesson]), null)
  })

  it("окно активности — 30 дней", () => {
    assert.equal(ACTIVE_ENGAGEMENT_WINDOW_DAYS, 30)
  })
})
