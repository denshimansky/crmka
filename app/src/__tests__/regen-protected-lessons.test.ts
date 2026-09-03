/**
 * Unit-тесты для partitionRegenLessons — чистого ядра перегенерации расписания
 * группы (смена шаблонов и смена дат жизни группы).
 *
 * Главное правило: занятие вне шаблонов удаляемо, только если человек его не
 * трогал. Защищают отметки, активные пробные и ручной перенос.
 *
 * Регресс, из которого выросли тесты: групповое пробное живёт ссылкой
 * trial_lessons.lesson_id (FK ON DELETE SET NULL) и не создаёт Attendance до
 * отметки. Перегенерация удаляла занятие «не по шаблону» (например, перенесённое
 * на субботу у группы ВТ/ЧТ), FK молча обнулял ссылку — и пробное оставалось
 * сиротой: без времени, без карточки занятия и вне состава занятия.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  partitionRegenLessons,
  type RegenLessonRow,
} from "../lib/schedule/generate-group-lessons"

/** Шаблоны: 0=Пн..6=Вс. Группа ВТ/ЧТ 17:00 → слоты 1_17:00 и 3_17:00. */
const TUE_THU_17 = new Set(["1_17:00", "3_17:00"])

// 2026-09-03 — четверг (по шаблону), 2026-09-05 — суббота (вне шаблона).
// Даты локальные: ядро определяет день недели через getDay(), как и генератор.
const THU = new Date(2026, 8, 3)
const SAT = new Date(2026, 8, 5)

function row(over: Partial<RegenLessonRow> = {}): RegenLessonRow {
  return {
    id: "l1",
    date: SAT,
    startTime: "17:00",
    status: "scheduled",
    rescheduledFromDate: null,
    _count: { attendances: 0, trialLessons: 0 },
    ...over,
  }
}

describe("partitionRegenLessons", () => {
  it("занятие по шаблону не трогаем", () => {
    const p = partitionRegenLessons([row({ date: THU })], TUE_THU_17)
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.removedDates.length, 0)
  })

  it("чистое занятие вне шаблона удаляется и идёт в пересчёт абонементов", () => {
    const p = partitionRegenLessons([row({ id: "sat" })], TUE_THU_17)
    assert.deepEqual(p.toDelete, ["sat"])
    assert.deepEqual(p.removedDates, [SAT])
  })

  it("занятие с активным пробным вне шаблона СОХРАНЯЕТСЯ (иначе пробное осиротеет)", () => {
    const p = partitionRegenLessons(
      [row({ id: "sat", _count: { attendances: 0, trialLessons: 1 } })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.keptWithTrials, 1)
    assert.equal(p.removedDates.length, 0)
  })

  it("занятие с отметкой вне шаблона сохраняется", () => {
    const p = partitionRegenLessons(
      [row({ id: "sat", _count: { attendances: 1, trialLessons: 0 } })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.keptWithAttendance, 1)
  })

  it("вручную перенесённое занятие вне шаблона сохраняется — решение человека не откатываем", () => {
    const p = partitionRegenLessons(
      [row({ id: "sat", rescheduledFromDate: THU })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.keptRescheduled, 1)
  })

  it("занятие в шаблонный день, но в другое время — вне шаблона", () => {
    const p = partitionRegenLessons(
      [row({ id: "thu-19", date: THU, startTime: "19:00" })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, ["thu-19"])
  })

  it("отменённое занятие удаляется, но в пересчёт абонементов не идёт", () => {
    const p = partitionRegenLessons(
      [row({ id: "sat", status: "cancelled" })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, ["sat"])
    assert.equal(p.removedDates.length, 0)
  })

  it("outOfBounds: занятие вне срока жизни группы удаляется даже по шаблону", () => {
    const p = partitionRegenLessons(
      [row({ id: "thu-out", date: THU, outOfBounds: true })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, ["thu-out"])
    assert.deepEqual(p.removedDates, [THU])
  })

  it("outOfBounds: но пробное защищает и за границами срока жизни", () => {
    const p = partitionRegenLessons(
      [
        row({
          id: "thu-out",
          date: THU,
          outOfBounds: true,
          _count: { attendances: 0, trialLessons: 1 },
        }),
      ],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.keptWithTrials, 1)
  })

  it("пустые шаблоны: все занятия — кандидаты, защиты продолжают действовать", () => {
    const p = partitionRegenLessons(
      [
        row({ id: "a", date: THU }),
        row({ id: "b", date: THU, _count: { attendances: 0, trialLessons: 2 } }),
        row({ id: "c", date: THU, rescheduledFromDate: SAT }),
        row({ id: "d", date: THU, _count: { attendances: 3, trialLessons: 0 } }),
      ],
      new Set(),
    )
    assert.deepEqual(p.toDelete, ["a"])
    assert.equal(p.keptWithTrials, 1)
    assert.equal(p.keptRescheduled, 1)
    assert.equal(p.keptWithAttendance, 1)
  })

  it("смешанный набор: считает каждую причину сохранения отдельно", () => {
    const p = partitionRegenLessons(
      [
        row({ id: "keep-tpl", date: THU }),
        row({ id: "del-1" }),
        row({ id: "del-2", startTime: "10:00" }),
        row({ id: "trial", _count: { attendances: 0, trialLessons: 1 } }),
        row({ id: "marked", _count: { attendances: 2, trialLessons: 0 } }),
        row({ id: "moved", rescheduledFromDate: THU }),
      ],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, ["del-1", "del-2"])
    assert.equal(p.keptWithTrials, 1)
    assert.equal(p.keptWithAttendance, 1)
    assert.equal(p.keptRescheduled, 1)
    assert.equal(p.removedDates.length, 2)
  })
})
