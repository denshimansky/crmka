import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildInstructorSalaryDetail } from "../lib/salary/instructor-detail"

// Хелпер отметки: дата занятия задаёт «до 15-го» (день <= 15).
function att(lessonId: string, day: number, dirId: string | null, dirName: string, amount: number) {
  return {
    lessonId,
    date: new Date(Date.UTC(2026, 5, day)), // июнь 2026
    groupName: "Гр",
    directionId: dirId,
    directionName: dirName,
    typeName: "Был",
    instructorPayAmount: amount,
  }
}

describe("buildInstructorSalaryDetail", () => {
  it("разносит начисления по направлениям, считает до-15-го, остаток и итоги", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [
        att("l1", 5, "d1", "Рисование", 720),   // до 15-го
        att("l1", 5, "d1", "Рисование", 600),   // та же l1 → 1 занятие, 2 ученика
        att("l2", 20, "d1", "Рисование", 600),  // после 15-го
        att("l3", 7, "d2", "Английский", 480),  // до 15-го
      ],
      adjustments: [
        { type: "bonus", amount: 2000 },
        { type: "penalty", amount: 500 },
      ],
      paymentItems: [
        { directionId: "d1", amount: 1000 },    // уже выплачено по Рисованию
        { directionId: null, amount: 300 },     // выплата без направления (legacy)
      ],
      salaried: null,
    })

    const draw = res.byDirection.find((d) => d.directionId === "d1")!
    assert.equal(draw.accrued, 1920)            // 720+600+600
    assert.equal(draw.accruedFirstHalf, 1320)   // 720+600 (день 5), без дня 20
    assert.equal(draw.paid, 1000)
    assert.equal(draw.remaining, 920)           // 1920-1000
    assert.equal(draw.lessonCount, 2)           // l1, l2

    assert.equal(res.adjustments.net, 1500)             // 2000-500
    assert.equal(res.adjustments.paidNoDirection, 300)
    assert.equal(res.adjustments.remaining, 1200)       // 1500-300

    assert.equal(res.totals.accrued, 2400)              // 1920 + 480
    assert.equal(res.totals.paid, 1300)                 // 1000 + 300
    assert.equal(res.totals.remaining, 2600)            // 2400 + 2000 - 500 - 1300

    // Занятия: l1 агрегировано (2 ученика, 1320), отсортированы по дате asc
    const l1 = res.lessons.find((l) => l.lessonId === "l1")!
    assert.equal(l1.studentsCharged, 2)
    assert.equal(l1.amount, 1320)
  })

  it("окладник: accrued = оклад, accruedFirstHalf = половина оклада", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [],
      paymentItems: [],
      salaried: { monthlySalary: 40000, defaultDirectionId: "d9", defaultDirectionName: "Менеджмент" },
    })
    const d = res.byDirection.find((x) => x.directionId === "d9")!
    assert.equal(d.accrued, 40000)
    assert.equal(d.accruedFirstHalf, 20000)
    assert.equal(res.totals.accrued, 40000)
  })

  it("окладник без направления: аванс без направления уменьшает остаток строки «Без направления»", () => {
    // Регрессия: аванс окладника (directionId=null) раньше уходил в невидимый (при net=0)
    // блок adjustments, а строка «Без направления» и пресет модалки показывали весь оклад.
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [],
      paymentItems: [{ directionId: null, amount: 3520 }], // выплаченный аванс
      salaried: { monthlySalary: 7400, defaultDirectionId: null, defaultDirectionName: "Без направления" },
    })
    const nd = res.byDirection.find((d) => d.directionId === null)!
    assert.equal(nd.accrued, 7400)
    assert.equal(nd.paid, 3520)          // раньше было 0
    assert.equal(nd.remaining, 3880)     // раньше было 7400
    // Аванс оклада не должен оседать в «Премии−штрафы».
    assert.equal(res.adjustments.paidNoDirection, 0)
    assert.equal(res.adjustments.remaining, 0)
    assert.equal(res.totals.paid, 3520)
    assert.equal(res.totals.remaining, 3880)
  })

  it("окладник без направления + премия: оклад поглощает свою часть, излишек — в «Премии−штрафы»", () => {
    // Полностью выплачено: аванс+остаток оклада (7400) + премия (1000) = 8400 без направления.
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [{ type: "bonus", amount: 1000 }],
      paymentItems: [{ directionId: null, amount: 8400 }],
      salaried: { monthlySalary: 7400, defaultDirectionId: null, defaultDirectionName: "Без направления" },
    })
    const nd = res.byDirection.find((d) => d.directionId === null)!
    assert.equal(nd.paid, 7400)          // оклад берёт min(8400, 7400)
    assert.equal(nd.remaining, 0)
    assert.equal(res.adjustments.paidNoDirection, 1000) // излишек сверх оклада
    assert.equal(res.adjustments.remaining, 0)          // премия 1000 − 1000
    assert.equal(res.totals.paid, 8400)
    assert.equal(res.totals.remaining, 0)               // 7400 + 1000 − 8400
  })

  it("окладник С направлением: legacy-выплата без направления (net=0) гасит строку оклада d1 (#1)", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [],
      paymentItems: [{ directionId: null, amount: 3520 }],
      salaried: { monthlySalary: 7400, defaultDirectionId: "d1", defaultDirectionName: "Танцы" },
    })
    const d1 = res.byDirection.find((d) => d.directionId === "d1")!
    assert.equal(d1.accrued, 7400)
    assert.equal(d1.paid, 3520)        // раньше 0 → пресет «Выплатить остатки» переплачивал
    assert.equal(d1.remaining, 3880)
    assert.equal(res.adjustments.paidNoDirection, 0)
    assert.equal(res.totals.remaining, 3880)
  })

  it("окладник С направлением + выплаченная премия: премия НЕ засчитывается в оклад (регрессия #2)", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [{ type: "bonus", amount: 2000 }],
      paymentItems: [{ directionId: null, amount: 2000 }], // выплаченная премия
      salaried: { monthlySalary: 10000, defaultDirectionId: "d1", defaultDirectionName: "Танцы" },
    })
    const d1 = res.byDirection.find((d) => d.directionId === "d1")!
    assert.equal(d1.paid, 0)           // оклад не тронут (раньше показывал 2000)
    assert.equal(d1.remaining, 10000)
    assert.equal(res.adjustments.paidNoDirection, 2000) // премия зачтена в премии−штрафы
    assert.equal(res.adjustments.remaining, 0)          // 2000 − 2000
    assert.equal(res.totals.remaining, 10000)
  })

  it("осиротевшая выплата по направлению без начислений — отдельная строка, инвариант сходится (#3)", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [att("l1", 5, "d1", "Рисование", 1000)],
      adjustments: [],
      paymentItems: [
        { directionId: "d1", amount: 500 },
        { directionId: "d2", amount: 300, directionName: "Английский" }, // у d2 нет начислений
      ],
      salaried: null,
    })
    const d1 = res.byDirection.find((d) => d.directionId === "d1")!
    assert.equal(d1.paid, 500)
    assert.equal(d1.remaining, 500)
    const orphan = res.byDirection.find((d) => d.directionId === "d2")!
    assert.equal(orphan.accrued, 0)
    assert.equal(orphan.paid, 300)
    assert.equal(orphan.remaining, -300)
    assert.equal(orphan.directionName, "Английский")
    // Инвариант: Σ остаток по строкам + остаток премий == общий остаток.
    const sumRows =
      res.byDirection.reduce((s, d) => s + d.remaining, 0) + res.adjustments.remaining
    assert.equal(sumRows, res.totals.remaining)
    assert.equal(res.totals.remaining, 200) // 1000 − (500 + 300)
  })
  it("премии/штрафы — построчная расшифровка с причиной; Σ строк == итог", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [att("l1", 5, "d1", "Рисование", 1000)],
      adjustments: [
        { id: "a2", type: "bonus", amount: 500, comment: "За открытый урок", createdAt: new Date(Date.UTC(2026, 5, 20)) },
        { id: "a1", type: "penalty", amount: 200, comment: "Опоздание", createdAt: new Date(Date.UTC(2026, 5, 10)) },
      ],
      paymentItems: [{ directionId: null, amount: 300 }],
      salaried: null,
    })

    const items = res.adjustments.items
    assert.equal(items.length, 2)
    // Порядок — хронологический (штраф от 10-го раньше премии от 20-го).
    assert.equal(items[0].id, "a1")
    assert.equal(items[0].amount, -200)      // штраф уходит в «Начислено» минусом
    assert.equal(items[0].paid, 0)           // штраф ничего не «выплачивает»
    assert.equal(items[0].comment, "Опоздание")
    assert.equal(items[0].isAuto, false)
    assert.equal(items[1].id, "a2")
    assert.equal(items[1].amount, 500)
    assert.equal(items[1].paid, 300)         // выплата без направления гасит премию
    assert.equal(items[1].remaining, 200)

    // Инварианты: Σ по строкам сходится с агрегатом.
    assert.equal(items.reduce((s, a) => s + a.amount, 0), res.adjustments.net)
    assert.equal(items.reduce((s, a) => s + a.paid, 0), res.adjustments.paidNoDirection)
    assert.equal(items.reduce((s, a) => s + a.remaining, 0), res.adjustments.remaining)
  })

  it("метка [Авто-корректировка] в комментарии → isAuto", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [],
      adjustments: [{ id: "a1", type: "bonus", amount: 100, comment: "[Авто-корректировка] Откат отметки" }],
      paymentItems: [],
      salaried: null,
    })
    assert.equal(res.adjustments.items[0].isAuto, true)
  })

  it("выплата без направления сверх премий — техстрока «излишек», инвариант держится", () => {
    const res = buildInstructorSalaryDetail({
      attendances: [att("l1", 5, "d1", "Рисование", 1000)],
      adjustments: [{ id: "a1", type: "bonus", amount: 100, comment: "Премия" }],
      paymentItems: [{ directionId: null, amount: 400 }],
      salaried: null,
    })
    const items = res.adjustments.items
    assert.equal(items.length, 2)
    assert.equal(items[0].paid, 100)         // премия закрыта целиком
    assert.equal(items[1].type, "payment")
    assert.equal(items[1].amount, 0)
    assert.equal(items[1].paid, 300)         // 400 − 100
    assert.equal(items[1].remaining, -300)
    assert.equal(items.reduce((s, a) => s + a.paid, 0), res.adjustments.paidNoDirection)
    assert.equal(items.reduce((s, a) => s + a.remaining, 0), res.adjustments.remaining)
  })
})
