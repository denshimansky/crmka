/**
 * Unit-тесты consumed-семантики (07.07.2026, баг «Уваж. пропуск не пересчитывал
 * абонемент»):
 *  - consumed-lessons.ts: какие типы расходуют занятие календарного/пакетного;
 *  - repriceSubscription: Уваж. пропуск уменьшает finalAmount/balance
 *    календарного абонемента; переплата уходит возвратом на баланс родителя;
 *    discountAmount не раздувается прощёнными пропусками (чистая скидка).
 *
 * Чистая логика без БД — мок-Tx по образцу prorate-scheduled-withdrawal.test.ts.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import {
  NON_CONSUMING_CODES,
  consumedTypeWhereFor,
  isConsumingAttendanceType,
} from "../lib/subscriptions/consumed-lessons"
import {
  repriceSubscription,
  debtCoverageFromBalance,
} from "../lib/discounts/recalc-client-discounts"

const D = (v: number | string) => new Prisma.Decimal(v)

describe("isConsumingAttendanceType", () => {
  it("списывающие расходуют всегда", () => {
    assert.equal(isConsumingAttendanceType({ chargesSubscription: true, code: "present" }), true)
    assert.equal(isConsumingAttendanceType({ chargesSubscription: true, code: "absent" }), true)
  })

  it("финальные несписывающие расходуют (Уваж. пропуск, Перерасчёт, кастомные)", () => {
    assert.equal(isConsumingAttendanceType({ chargesSubscription: false, code: "excused" }), true)
    assert.equal(isConsumingAttendanceType({ chargesSubscription: false, code: "recalculation" }), true)
    assert.equal(isConsumingAttendanceType({ chargesSubscription: false, code: "custom_xyz" }), true)
  })

  it("промежуточные/служебные НЕ расходуют: no_show, makeup_scheduled, makeup", () => {
    for (const code of NON_CONSUMING_CODES) {
      assert.equal(
        isConsumingAttendanceType({ chargesSubscription: false, code }),
        false,
        `код ${code} не должен расходовать занятие`,
      )
    }
  })

  it("consumedTypeWhereFor: пакетный тип — только списывающие", () => {
    assert.deepEqual(consumedTypeWhereFor("package"), { chargesSubscription: true })
  })

  it("consumedTypeWhereFor: календарный — списывающие ИЛИ финальные несписывающие", () => {
    const w = consumedTypeWhereFor("calendar") as any
    assert.ok(Array.isArray(w.OR))
    assert.deepEqual(w.OR[0], { chargesSubscription: true })
    assert.deepEqual(w.OR[1], { code: { notIn: NON_CONSUMING_CODES } })
  })
})

// ─── repriceSubscription на мок-Tx ───

interface MockOpts {
  sub?: Record<string, unknown> | null
  /** Число израсходованных отметок (consumed where) и списывающих (charging where). */
  consumedCount?: number
  chargedCount?: number
  /** Σ оплачено (transfer_in + refund<0). */
  paid?: number
  /** Баланс родителя (для варианта A — автопокрытие долга active-абонемента). */
  clientBalance?: number
}

function makeTx(opts: MockOpts) {
  const calls = {
    subUpdate: [] as any[],
    paymentCreate: [] as any[],
    balanceTx: [] as any[],
    countWheres: [] as any[],
  }
  const sub =
    opts.sub === undefined
      ? {
          id: "s1",
          clientId: "c1",
          wardId: null,
          groupId: "g1",
          directionId: "d1",
          type: "calendar",
          status: "active",
          lessonPrice: D(950),
          totalLessons: 4,
          totalAmount: D(3800),
          chargedAmount: D(0),
          discountPerLesson: D(0),
          discountSource: "none",
        }
      : opts.sub
  const tx = {
    subscription: {
      findFirst: async (_args: any) => sub,
      update: async (args: any) => {
        calls.subUpdate.push(args)
        return { id: args.where.id }
      },
    },
    attendance: {
      count: async (args: any) => {
        calls.countWheres.push(args.where)
        // Первая — consumed (OR-фильтр), вторая — charging (chargesSubscription=true).
        const isChargingOnly =
          args.where.attendanceType && args.where.attendanceType.chargesSubscription === true
        return isChargingOnly ? (opts.chargedCount ?? 0) : (opts.consumedCount ?? 0)
      },
    },
    payment: {
      aggregate: async (_args: any) => ({ _sum: { amount: D(opts.paid ?? 0) } }),
      create: async (args: any) => {
        calls.paymentCreate.push(args)
        return { id: "p-storno" }
      },
    },
    financialAccount: {
      findFirst: async (_args: any) => ({ id: "acc1" }),
    },
    clientBalanceTransaction: {
      // applyBalanceDelta: создаёт транзакцию и апдейтит клиента
      create: async (args: any) => {
        calls.balanceTx.push(args)
        return { id: "bt1" }
      },
      aggregate: async (_args: any) => ({ _sum: { amount: D(0) } }),
    },
    client: {
      update: async (_args: any) => ({ clientBalance: D(opts.clientBalance ?? 0) }),
      updateMany: async (_args: any) => ({ count: 0 }),
      findUnique: async (_args: any) => ({ id: "c1", clientBalance: D(opts.clientBalance ?? 0) }),
      findFirst: async (_args: any) => ({ id: "c1", clientBalance: D(opts.clientBalance ?? 0) }),
    },
    groupEnrollment: {
      updateMany: async (_args: any) => ({ count: 1 }),
    },
  }
  return { tx, calls }
}

describe("repriceSubscription — consumed-семантика", () => {
  it("Уваж. пропуск расходует занятие: finalAmount = 3×950, balance = 0 при оплате 2850 (кейс Самотейкина)", async () => {
    // 4 занятия по 950, оплачено 2850 (3 занятия), 1 уваж. пропуск, 0 списаний.
    const { tx, calls } = makeTx({ consumedCount: 1, chargedCount: 0, paid: 2850 })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    assert.equal(calls.subUpdate.length, 1)
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.finalAmount), 2850, "finalAmount = (4−1)×950")
    assert.equal(Number(data.balance), 0, "фантомный долг за пропуск исчез")
    assert.equal(Number(data.discountAmount), 0, "пропуск — не скидка")
    assert.equal(calls.paymentCreate.length, 0, "переплаты нет — возврат не создаётся")
  })

  it("переплата при пропуске → возврат на баланс родителя + сторно-платёж", async () => {
    // Оплачено все 3800, 3 списанных + 1 уваж. пропуск → finalAmount 2850+0...
    // chargedAmount=2850 (3×950), consumed=4, остаток 0 → final=2850, paid=3800 → возврат 950.
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "active",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(2850), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 4,
      chargedCount: 3,
      paid: 3800,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.finalAmount), 2850)
    assert.equal(Number(data.balance), 0)
    assert.equal(calls.paymentCreate.length, 1, "сторно-платёж создан")
    assert.equal(Number(calls.paymentCreate[0].data.amount), -950)
    assert.equal(
      calls.paymentCreate[0].data.comment,
      "Возврат по перерасчёту абонемента",
    )
    // Возврат на баланс родителя (discount_refund) на 950.
    const refundTx = calls.balanceTx.find((b) => b.data?.type === "discount_refund")
    assert.ok(refundTx, "discount_refund создан")
    assert.equal(Number(refundTx.data.amount), 950)
    assert.equal(Number(data.discountAmount), 0, "возврат за пропуск — не скидка")
  })

  it("discountAmount — только скидочная часть при скидке + пропуске", async () => {
    // Цена 1000, скидка 100/занятие, 4 занятия (номинал 4000), 1 уваж. пропуск,
    // 0 списаний: final = 3×900 = 2700; totalAmount−final = 1300, из них 1000 —
    // прощённый пропуск → чистая скидка 300.
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "active",
        lessonPrice: D(1000), totalLessons: 4, totalAmount: D(4000),
        chargedAmount: D(0), discountPerLesson: D(100), discountSource: "type1",
      },
      consumedCount: 1,
      chargedCount: 0,
      paid: 0,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.finalAmount), 2700)
    assert.equal(Number(data.discountAmount), 300, "скидка 3×100, пропуск не входит")
  })

  it("pending без оплат, все занятия — Уваж. пропуск → НЕ активируется (нет ложного «Купил»)", async () => {
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: "w1", groupId: "g1", directionId: "d1",
        type: "calendar", status: "pending",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(0), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 4,
      chargedCount: 0,
      paid: 0,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.balance), 0, "долг погашен пропусками")
    // activateSubscription первым делом ставит status: "active" — такого апдейта
    // быть не должно (paid=0 и занятия не бесплатные).
    const activated = calls.subUpdate.some((u) => u.data?.status === "active")
    assert.equal(activated, false, "неоплаченный pending не активируется пропусками")
  })

  it("pending, частично оплачен + пропуск закрыл остаток → активируется (кейс Самотейкина)", async () => {
    // wardId=null: активация без побочных эффектов заявок (ранний выход).
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "pending",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(0), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 1,
      chargedCount: 0,
      paid: 2850,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const activated = calls.subUpdate.some((u) => u.data?.status === "active")
    assert.equal(activated, true, "оплата есть, долга нет → активация")
  })

  it("guard: закрытый/отчисленный/legacy не пересчитываются", async () => {
    for (const sub of [
      { status: "closed", discountSource: "none" },
      { status: "withdrawn", discountSource: "none" },
      { status: "active", discountSource: "legacy" },
    ]) {
      const { tx, calls } = makeTx({
        sub: {
          id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
          type: "calendar", lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
          chargedAmount: D(0), discountPerLesson: D(0), ...sub,
        },
        consumedCount: 1,
      })
      await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
      assert.equal(calls.subUpdate.length, 0, `${sub.status}/${sub.discountSource} не трогаем`)
    }
  })

  it("пакетный: уваж. пропуск занятие НЕ сжигает (consumed-where только по списывающим)", async () => {
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "package", status: "active",
        lessonPrice: D(950), totalLessons: 8, totalAmount: D(7600),
        chargedAmount: D(0), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 0,
      chargedCount: 0,
      paid: 7600,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    // Первый count (израсходовано) для package должен идти по chargesSubscription=true.
    assert.deepEqual(calls.countWheres[0].attendanceType, { chargesSubscription: true })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.finalAmount), 7600, "пакет не дешевеет от пропуска")
    assert.equal(calls.paymentCreate.length, 0, "возврата нет")
  })
})

// ─── Вариант A: симметричное автопокрытие долга с баланса ───

describe("debtCoverageFromBalance", () => {
  it("active + долг + плюс на балансе → min(долг, баланс)", () => {
    assert.equal(Number(debtCoverageFromBalance("active", D(1300), D(3750))), 1300)
    assert.equal(Number(debtCoverageFromBalance("active", D(1300), D(700))), 700)
  })

  it("нет долга / нет баланса / переплата → 0", () => {
    assert.equal(Number(debtCoverageFromBalance("active", D(0), D(3750))), 0)
    assert.equal(Number(debtCoverageFromBalance("active", D(1300), D(0))), 0)
    assert.equal(Number(debtCoverageFromBalance("active", D(-100), D(3750))), 0)
  })

  it("pending НЕ гасим с баланса (долг = «ждём оплату»)", () => {
    assert.equal(Number(debtCoverageFromBalance("pending", D(1300), D(3750))), 0)
  })
})

describe("repriceSubscription — вариант A (автопокрытие долга)", () => {
  it("долг active-абонемента докрывается с баланса родителя (нет фантомного долга)", async () => {
    // final 3800 (все 4 списаны), оплачено 2850 → долг 950; на балансе 5000 →
    // докрываем 950: transfer_in +950, balance абонемента 0.
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "active",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(3800), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 4, chargedCount: 4, paid: 2850, clientBalance: 5000,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.finalAmount), 3800)
    assert.equal(Number(data.balance), 0, "долг докрыт с баланса")
    const cover = calls.paymentCreate.find((p) => Number(p.data.amount) === 950)
    assert.ok(cover, "transfer_in автопокрытия создан")
    assert.equal(cover.data.type, "transfer_in")
    assert.equal(cover.data.comment, "Автопокрытие долга с баланса (пересчёт)")
    const bt = calls.balanceTx.find((b) => b.data?.type === "transfer_to_subscription")
    assert.ok(bt, "списание с баланса transfer_to_subscription создано")
    assert.equal(Number(bt.data.amount), -950)
  })

  it("баланса меньше долга → покрываем частично, остаток — реальный долг", async () => {
    // Долг 950, на балансе только 400 → докрываем 400, остаётся долг 550.
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "active",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(3800), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 4, chargedCount: 4, paid: 2850, clientBalance: 400,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.balance), 550, "покрыт частично, остаток — долг")
    assert.equal(Number(calls.paymentCreate[0].data.amount), 400)
  })

  it("pending с долгом НЕ гасится с баланса даже при живом плюсе", async () => {
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "pending",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(0), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 0, chargedCount: 0, paid: 0, clientBalance: 5000,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.balance), 3800, "pending остаётся с долгом")
    assert.equal(calls.paymentCreate.length, 0, "автопокрытия нет")
  })

  it("нет денег на балансе → долг остаётся (как раньше)", async () => {
    const { tx, calls } = makeTx({
      sub: {
        id: "s1", clientId: "c1", wardId: null, groupId: "g1", directionId: "d1",
        type: "calendar", status: "active",
        lessonPrice: D(950), totalLessons: 4, totalAmount: D(3800),
        chargedAmount: D(3800), discountPerLesson: D(0), discountSource: "none",
      },
      consumedCount: 4, chargedCount: 4, paid: 2850, clientBalance: 0,
    })
    await repriceSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    const data = calls.subUpdate[0].data
    assert.equal(Number(data.balance), 950, "без баланса долг остаётся")
    assert.equal(calls.paymentCreate.length, 0, "автопокрытия нет")
  })
})
