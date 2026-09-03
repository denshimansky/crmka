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
  groupLifeDatesChanged,
  type RegenLessonRow,
} from "../lib/schedule/generate-group-lessons"

/** Шаблоны: 0=Пн..6=Вс. Группа ВТ/ЧТ 17:00 → слоты 1_17:00 и 3_17:00. */
const TUE_THU_17 = new Set(["1_17:00", "3_17:00"])

// 2026-09-03 — четверг (по шаблону), 2026-09-05 — суббота (вне шаблона).
// Даты локальные: ядро определяет день недели через getDay(), как и генератор.
const THU = new Date(2026, 8, 3)
const SAT = new Date(2026, 8, 5)

function row(
  over: Partial<Omit<RegenLessonRow, "_count">> & {
    _count?: Partial<RegenLessonRow["_count"]>
  } = {},
): RegenLessonRow {
  const { _count, ...rest } = over
  return {
    id: "l1",
    date: SAT,
    startTime: "17:00",
    status: "scheduled",
    rescheduledFromDate: null,
    _count: {
      attendances: 0,
      trialLessons: 0,
      scheduledMakeupAttendances: 0,
      ..._count,
    },
    ...rest,
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

  it("занятие с назначенной отработкой вне шаблона сохраняется", () => {
    const p = partitionRegenLessons(
      [row({ id: "sat", _count: { scheduledMakeupAttendances: 1 } })],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, [])
    assert.equal(p.keptWithScheduledMakeup, 1)
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
        row({ id: "makeup", _count: { scheduledMakeupAttendances: 2 } }),
        row({ id: "moved", rescheduledFromDate: THU }),
      ],
      TUE_THU_17,
    )
    assert.deepEqual(p.toDelete, ["del-1", "del-2"])
    assert.equal(p.keptWithTrials, 1)
    assert.equal(p.keptWithAttendance, 1)
    assert.equal(p.keptWithScheduledMakeup, 1)
    assert.equal(p.keptRescheduled, 1)
    assert.equal(p.removedDates.length, 2)
  })
})

/**
 * Гейт перестройки расписания. Форма «Настройки» карточки группы шлёт
 * startDate/endDate в каждом PATCH, поэтому проверка «ключ пришёл» означала,
 * что ЛЮБОЕ «Сохранить» перестраивает расписание и пересчитывает абонементы.
 */
describe("groupLifeDatesChanged", () => {
  const existing = {
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  }

  it("ключей нет — даты не трогали", () => {
    assert.equal(groupLifeDatesChanged(existing, {}), false)
  })

  it("прислали те же даты (правили только название) — перестройки нет", () => {
    assert.equal(
      groupLifeDatesChanged(existing, {
        startDate: "2026-09-01",
        endDate: "2027-05-31",
      }),
      false,
    )
  })

  it("сдвинули старт — перестройка нужна", () => {
    assert.equal(
      groupLifeDatesChanged(existing, {
        startDate: "2026-09-08",
        endDate: "2027-05-31",
      }),
      true,
    )
  })

  it("сдвинули окончание — перестройка нужна", () => {
    assert.equal(
      groupLifeDatesChanged(existing, { endDate: "2027-06-30" }),
      true,
    )
  })

  it("сняли дату окончания — перестройка нужна", () => {
    assert.equal(groupLifeDatesChanged(existing, { endDate: null }), true)
  })

  it("дата окончания и была пустой, и осталась — перестройки нет", () => {
    assert.equal(
      groupLifeDatesChanged(
        { startDate: existing.startDate, endDate: null },
        { startDate: "2026-09-01", endDate: null },
      ),
      false,
    )
  })

  it("в базе дата со временем, прислали тот же день — перестройки нет", () => {
    assert.equal(
      groupLifeDatesChanged(
        { startDate: new Date("2026-09-01T09:30:00.000Z"), endDate: null },
        { startDate: "2026-09-01" },
      ),
      false,
    )
  })

  it("дату задали там, где её не было — перестройка нужна", () => {
    assert.equal(
      groupLifeDatesChanged(
        { startDate: null, endDate: null },
        { startDate: "2026-09-01" },
      ),
      true,
    )
  })
})
