/**
 * Unit-тесты реаллокации ЗП занятия (09.07.2026, баг «плавающая ставка зависит
 * от порядка кликов»: пришло 5 — начислено по брекету «3»; носитель ставки
 * перемечен — занятие 0 при полном составе; дубль отметки клиента ломал порог).
 *
 * computePayTargets — чистая функция: раскладка ЗП по итоговому составу.
 * Критерий участия — «Оплата инструктору» на отметке (дефолт — колонка
 * «Начисление инструктору» вида посещения; решение владельца 10.07.2026):
 * «Был» и оплачиваемый «Прогул» двигают порог, «Не был»/«Уваж. пропуск» — нет.
 * Пробные отметки (isTrial) — контекст: двигают порог floating и «занимают»
 * ставку занятия своим начислением, но в целевую раскладку не входят.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import { computePayTargets, type PayTargetAttendance } from "../lib/salary/reallocate-lesson-pay"

const D = (v: number | string) => new Prisma.Decimal(v)

const FLOATING = {
  scheme: "floating_by_students",
  ratePerLesson: null,
  // Брекеты Dream: от 3 учеников, +120 за каждого следующего
  brackets: [
    { minStudents: 3, ratePerLesson: D(360) },
    { minStudents: 4, ratePerLesson: D(480) },
    { minStudents: 5, ratePerLesson: D(600) },
  ],
}

const PER_LESSON = { scheme: "per_lesson", ratePerLesson: D(700), brackets: [] }

let seq = 0
function att(over: Partial<PayTargetAttendance> = {}): PayTargetAttendance {
  seq += 1
  return {
    id: `att-${seq}`,
    clientId: `client-${seq}`,
    wardId: null,
    payEnabled: true,
    isTrial: false,
    payAmount: D(0),
    at: new Date(2026, 6, 6, 12, 0, seq),
    ...over,
  }
}

function total(targets: Map<string, Prisma.Decimal>): number {
  let sum = D(0)
  for (const v of targets.values()) sum = sum.add(v)
  return Number(sum)
}

describe("computePayTargets: floating_by_students", () => {
  it("брекет по итоговому числу оплачиваемых, вся ставка на первой отметке", () => {
    const a1 = att()
    const a2 = att()
    const a3 = att()
    const a4 = att()
    const a5 = att()
    const targets = computePayTargets(FLOATING, [a1, a2, a3, a4, a5])
    assert.equal(Number(targets.get(a1.id)), 600, "носитель — первая отметка, брекет «5»")
    assert.equal(total(targets), 600, "сумма занятия = одна ставка")
  })

  it("порядок в массиве не важен — носитель выбирается по времени отметки", () => {
    const late = att({ at: new Date(2026, 6, 6, 14, 0) })
    const early = att({ at: new Date(2026, 6, 6, 12, 0) })
    const mid = att({ at: new Date(2026, 6, 6, 13, 0) })
    const targets = computePayTargets(FLOATING, [late, early, mid])
    assert.equal(Number(targets.get(early.id)), 360)
    assert.equal(Number(targets.get(late.id)), 0)
  })

  it("дубль отметки клиента не завышает порог (Каллиграфия 07.07)", () => {
    const a1 = att()
    const dupSource = att()
    const dup = att({ clientId: dupSource.clientId, wardId: dupSource.wardId })
    const targets = computePayTargets(FLOATING, [a1, dupSource, dup])
    assert.equal(total(targets), 0, "уникальных учеников 2 — брекета «2» нет, ставка 0")
  })

  it("два подопечных одного клиента — два ученика", () => {
    const parent = "client-shared"
    const a1 = att({ clientId: parent, wardId: "ward-1" })
    const a2 = att({ clientId: parent, wardId: "ward-2" })
    const a3 = att()
    const targets = computePayTargets(FLOATING, [a1, a2, a3])
    assert.equal(total(targets), 360)
  })

  it("оплачиваемый «Прогул» двигает порог (галочка «Начисление инструктору»)", () => {
    const absent = att() // «Прогул» с начислением: payEnabled=true
    const a2 = att()
    const a3 = att()
    const targets = computePayTargets(FLOATING, [absent, a2, a3])
    assert.equal(total(targets), 360, "3 оплачиваемых — брекет «3»")
    assert.equal(Number(targets.get(absent.id)), 360, "носитель — первая оплачиваемая")
  })

  it("«Не был»/«Уваж. пропуск» (без начисления) не двигают порог и не несут ставку", () => {
    const noShow = att({ payEnabled: false })
    const a2 = att()
    const a3 = att()
    const targets = computePayTargets(FLOATING, [noShow, a2, a3])
    assert.equal(total(targets), 0, "оплачиваемых 2 — порог «3» не достигнут")
    assert.equal(Number(targets.get(noShow.id)), 0)
  })

  it("выключенная вручную оплата исключает отметку", () => {
    const off = att({ payEnabled: false })
    const a2 = att()
    const a3 = att()
    const a4 = att()
    const targets = computePayTargets(FLOATING, [off, a2, a3, a4])
    assert.equal(Number(targets.get(a2.id)), 360, "носитель — первая включённая")
    assert.equal(Number(targets.get(off.id)), 0)
  })

  it("нет оплачиваемых отметок → 0", () => {
    const targets = computePayTargets(FLOATING, [att({ payEnabled: false })])
    assert.equal(total(targets), 0)
  })

  it("оплачиваемый пробный двигает порог, но не входит в цели", () => {
    const trial = att({ isTrial: true }) // пришедший пробный, payAmount=0
    const a2 = att()
    const a3 = att()
    const targets = computePayTargets(FLOATING, [trial, a2, a3])
    assert.equal(targets.has(trial.id), false, "пробная отметка — не цель апдейта")
    assert.equal(Number(targets.get(a2.id)), 360, "порог «3» достигнут с пробным")
    assert.equal(total(targets), 360)
  })

  it("неоплачиваемый пробный (trialPayMode=none) порог не двигает", () => {
    const trial = att({ isTrial: true, payEnabled: false })
    const a2 = att()
    const a3 = att()
    const targets = computePayTargets(FLOATING, [trial, a2, a3])
    assert.equal(total(targets), 0, "оплачиваемых 2 — порога «3» нет")
  })

  it("пробный с начисленной ставкой — носитель занятия: обычным 0 (нет 2× ставки)", () => {
    const trialCarrier = att({ isTrial: true, payAmount: D(360) })
    const a2 = att()
    const a3 = att()
    const targets = computePayTargets(FLOATING, [trialCarrier, a2, a3])
    assert.equal(total(targets), 0, "ставка уже на пробной отметке")
  })
})

describe("computePayTargets: per_lesson", () => {
  it("фикс за занятие на первой оплачиваемой отметке", () => {
    const a1 = att()
    const a2 = att()
    const targets = computePayTargets(PER_LESSON, [a1, a2])
    assert.equal(Number(targets.get(a1.id)), 700)
    assert.equal(total(targets), 700)
  })

  it("оплачиваемый прогул несёт ставку (занятие состоялось для инструктора)", () => {
    const absent = att()
    const targets = computePayTargets(PER_LESSON, [absent])
    assert.equal(Number(targets.get(absent.id)), 700)
  })

  it("нет оплачиваемых отметок → 0", () => {
    const targets = computePayTargets(PER_LESSON, [att({ payEnabled: false })])
    assert.equal(total(targets), 0)
  })

  it("пробный с начисленной ставкой — носитель занятия: обычным 0 (нет 2× ставки)", () => {
    const trialCarrier = att({ isTrial: true, payAmount: D(700) })
    const a2 = att()
    const targets = computePayTargets(PER_LESSON, [trialCarrier, a2])
    assert.equal(total(targets), 0, "ставка уже на пробной отметке")
  })
})

describe("computePayTargets: прочие схемы — не реаллоцируются функцией", () => {
  it("per_student → нули (расчёт остаётся per-attendance в calcPay)", () => {
    const targets = computePayTargets(
      { scheme: "per_student", ratePerLesson: null, brackets: [] },
      [att(), att()],
    )
    assert.equal(total(targets), 0)
  })
})
