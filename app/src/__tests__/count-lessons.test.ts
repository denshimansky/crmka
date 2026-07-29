/**
 * Unit-тесты подсчёта занятий группы для массовой выписки.
 *
 * Регрессия бага календаря 29.07.2026: countLessonsForGroup считала занятия
 * ПРОЕКЦИЕЙ шаблона расписания на диапазон, а не по фактическим Lesson-строкам.
 * Проекция расходилась с фактом и завышала выписку: «9 вместо 8» (несуществующий
 * понедельник 31.08) и «21 вместо 0» (Летний клуб закончился 31.07, но шаблон
 * Пн–Пт проецировался на август). Тесты фиксируют новый контракт: считаем
 * фактические занятия (status ≠ cancelled) в диапазоне — тот же источник правды,
 * что у ручной формы и реконсиляции дня.
 *
 * db инъектируется вторым аргументом (мок по образцу recalc-on-schedule-change.test.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { countLessonsForGroup } from "../lib/schedule/count-lessons"

function makeClient(opts: { templateCount: number; lessonCount: number }) {
  const calls: { lessonWhere?: any; templateWhere?: any } = {}
  const client = {
    groupScheduleTemplate: {
      count: async ({ where }: any) => {
        calls.templateWhere = where
        return opts.templateCount
      },
    },
    lesson: {
      count: async ({ where }: any) => {
        calls.lessonWhere = where
        return opts.lessonCount
      },
    },
  }
  return { client, calls }
}

const opts = {
  tenantId: "t1",
  groupId: "g1",
  rangeStart: new Date(2026, 7, 1), // Aug 1
  rangeEnd: new Date(2026, 7, 31), // Aug 31
}

describe("countLessonsForGroup", () => {
  it("считает фактические занятия, а не проекцию шаблона (9 vs 8)", async () => {
    // Проекция Пн+Ср дала бы 9, реальных занятий 8 — берём 8.
    const { client } = makeClient({ templateCount: 2, lessonCount: 8 })
    const r = await countLessonsForGroup(opts, client as any)
    assert.equal(r.count, 8)
    assert.equal(r.hasSchedule, true)
  })

  it("исключает отменённые занятия и скоупит по тенанту/группе", async () => {
    const { client, calls } = makeClient({ templateCount: 2, lessonCount: 8 })
    await countLessonsForGroup(opts, client as any)
    assert.deepEqual(calls.lessonWhere.status, { not: "cancelled" })
    assert.equal(calls.lessonWhere.tenantId, "t1")
    assert.equal(calls.lessonWhere.groupId, "g1")
  })

  it("завершённая группа (нет занятий в диапазоне): count=0 при живом шаблоне", async () => {
    // Летний клуб: шаблон активен (effectiveTo=null), но занятий в августе нет.
    const { client } = makeClient({ templateCount: 5, lessonCount: 0 })
    const r = await countLessonsForGroup(opts, client as any)
    assert.equal(r.count, 0)
    assert.equal(r.hasSchedule, true)
  })

  it("нет расписания вовсе: hasSchedule=false", async () => {
    const { client } = makeClient({ templateCount: 0, lessonCount: 0 })
    const r = await countLessonsForGroup(opts, client as any)
    assert.equal(r.hasSchedule, false)
    assert.equal(r.count, 0)
  })

  it("границы: gte = начало rangeStart, lte = конец rangeEnd (включительно)", async () => {
    const { client, calls } = makeClient({ templateCount: 1, lessonCount: 3 })
    await countLessonsForGroup(opts, client as any)
    const gte = calls.lessonWhere.date.gte as Date
    const lte = calls.lessonWhere.date.lte as Date
    assert.equal(gte.getFullYear(), 2026)
    assert.equal(gte.getMonth(), 7)
    assert.equal(gte.getDate(), 1)
    assert.equal(gte.getHours(), 0)
    assert.equal(lte.getFullYear(), 2026)
    assert.equal(lte.getMonth(), 7)
    assert.equal(lte.getDate(), 31)
    assert.equal(lte.getHours(), 23)
  })
})
