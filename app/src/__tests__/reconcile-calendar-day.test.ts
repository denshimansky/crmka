/**
 * Unit-тесты для partitionDeletableLessons — чистого ядра реконсиляции дня.
 *
 * Проверяем: удаляются только занятия без реальных отметок и без активных
 * пробных; их даты группируются по groupId для дельта-пересчёта абонементов.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { partitionDeletableLessons, type DeletableLessonRow } from "../lib/schedule/reconcile-calendar-day"

function row(
  id: string,
  groupId: string,
  attendances: number,
  trialLessons: number,
  date = new Date("2026-07-30T00:00:00.000Z"),
): DeletableLessonRow {
  return { id, groupId, date, _count: { attendances, trialLessons } }
}

describe("partitionDeletableLessons", () => {
  it("чистые занятия (без отметок и пробных) удаляемы и сгруппированы по группе", () => {
    const { deletableIds, removedDatesByGroup } = partitionDeletableLessons([
      row("l1", "g1", 0, 0),
      row("l2", "g1", 0, 0),
      row("l3", "g2", 0, 0),
    ])
    assert.deepEqual(deletableIds, ["l1", "l2", "l3"])
    assert.equal(removedDatesByGroup.get("g1")?.length, 2)
    assert.equal(removedDatesByGroup.get("g2")?.length, 1)
  })

  it("занятие с реальной отметкой не удаляется и не идёт в пересчёт", () => {
    const { deletableIds, removedDatesByGroup } = partitionDeletableLessons([
      row("l1", "g1", 1, 0), // есть отметка посещения
      row("l2", "g1", 0, 0),
    ])
    assert.deepEqual(deletableIds, ["l2"])
    assert.equal(removedDatesByGroup.get("g1")?.length, 1)
  })

  it("занятие с активным пробным не удаляется", () => {
    const { deletableIds } = partitionDeletableLessons([
      row("l1", "g1", 0, 1), // привязан активный пробный
    ])
    assert.deepEqual(deletableIds, [])
  })

  it("пустой вход — пустой результат", () => {
    const { deletableIds, removedDatesByGroup } = partitionDeletableLessons([])
    assert.deepEqual(deletableIds, [])
    assert.equal(removedDatesByGroup.size, 0)
  })
})
