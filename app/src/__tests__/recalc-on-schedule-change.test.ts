/**
 * Unit-тесты дельта-пересчёта календарных абонементов при изменении
 * расписания группы (создание/удаление занятий).
 *
 * scheduleChangeDelta — чистая функция дельты (личный диапазон абонемента,
 * поздний старт, запланированное отчисление); recalcSubscriptionsOnScheduleChange —
 * оркестрация с мок-Tx по образцу prorate-scheduled-withdrawal.test.ts:
 * recalcClientDiscounts no-op'ится через client.findFirst → null,
 * repriceSubscription — через subscription.findFirst → null.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  scheduleChangeDelta,
  recalcSubscriptionsOnScheduleChange,
} from "../lib/subscriptions/recalc-on-schedule-change"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

// Кейс «Майнкрафт 07.2026»: старт 07.07, выписано 7 занятий, потом группу
// продлили и появилось занятие 30.07 — абонемент должен стать 8 × 750.
const minecraftSub = {
  id: "s1",
  clientId: "c1",
  type: "calendar",
  status: "pending",
  startDate: utc(2026, 7, 7),
  endDate: null,
  periodYear: 2026,
  periodMonth: 7,
  scheduledWithdrawalDate: null,
  totalLessons: 7,
  lessonPrice: 750,
  discountAmount: 0,
  discountSource: "none",
}

describe("scheduleChangeDelta", () => {
  it("добавленное занятие в диапазоне: +1", () => {
    assert.equal(scheduleChangeDelta(minecraftSub, [utc(2026, 7, 30)], []), 1)
  })

  it("занятие раньше startDate (поздний старт): не считается", () => {
    assert.equal(scheduleChangeDelta(minecraftSub, [utc(2026, 7, 2)], []), 0)
  })

  it("занятие вне периода (следующий месяц): не считается", () => {
    assert.equal(scheduleChangeDelta(minecraftSub, [utc(2026, 8, 4)], []), 0)
  })

  it("удалённое занятие в диапазоне: −1", () => {
    assert.equal(scheduleChangeDelta(minecraftSub, [], [utc(2026, 7, 28)]), -1)
  })

  it("добавили и удалили: дельта суммируется", () => {
    assert.equal(
      scheduleChangeDelta(minecraftSub, [utc(2026, 7, 30)], [utc(2026, 7, 28)]),
      0,
    )
  })

  it("запланировано отчисление 15.07: занятие после X не считается, до X — считается", () => {
    const sub = { ...minecraftSub, scheduledWithdrawalDate: utc(2026, 7, 15) }
    assert.equal(scheduleChangeDelta(sub, [utc(2026, 7, 30)], []), 0)
    assert.equal(scheduleChangeDelta(sub, [utc(2026, 7, 9)], []), 1)
  })

  it("пакетный абонемент: дельты нет (totalLessons — купленное количество)", () => {
    assert.equal(
      scheduleChangeDelta({ ...minecraftSub, type: "package" }, [utc(2026, 7, 30)], []),
      0,
    )
  })

  it("граница включительно: занятие в последний день периода считается", () => {
    assert.equal(scheduleChangeDelta(minecraftSub, [utc(2026, 7, 31)], []), 1)
  })
})

type AnyArgs = { where?: Record<string, any>; data?: Record<string, any>; _sum?: any }

function makeTx(opts: { subs: any[]; paidSum?: number }) {
  const calls = {
    subFindMany: [] as AnyArgs[],
    subUpdate: [] as AnyArgs[],
    paymentAggregate: [] as AnyArgs[],
    clientFindFirst: [] as AnyArgs[],
    repriceFindFirst: [] as AnyArgs[],
  }
  const tx = {
    subscription: {
      findMany: async (args: AnyArgs) => {
        calls.subFindMany.push(args)
        return opts.subs
      },
      update: async (args: AnyArgs) => {
        calls.subUpdate.push(args)
        return {}
      },
      // repriceSubscription первым делом читает абонемент: null → ранний выход.
      findFirst: async (args: AnyArgs) => {
        calls.repriceFindFirst.push(args)
        return null
      },
    },
    client: {
      // recalcClientDiscounts первым делом читает клиента: null → ранний выход.
      findFirst: async (args: AnyArgs) => {
        calls.clientFindFirst.push(args)
        return null
      },
    },
    payment: {
      aggregate: async (args: AnyArgs) => {
        calls.paymentAggregate.push(args)
        return { _sum: { amount: opts.paidSum ?? 0 } }
      },
    },
  }
  return { tx, calls }
}

describe("recalcSubscriptionsOnScheduleChange", () => {
  it("кейс Майнкрафт: +занятие 30.07 → totalLessons 8, totalAmount 6000, скидки+reprice дёрнуты", async () => {
    const { tx, calls } = makeTx({ subs: [minecraftSub] })
    const res = await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [utc(2026, 7, 30)],
      removedDates: [],
      createdBy: null,
    })
    assert.equal(res.updated, 1)
    assert.equal(calls.subUpdate.length, 1)
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 8, totalAmount: 6000 })
    // Выборка только живых календарных абонементов группы (изоляция по tenant).
    const w = calls.subFindMany[0].where!
    assert.equal(w.tenantId, "t")
    assert.equal(w.groupId, "g")
    assert.equal(w.type, "calendar")
    assert.deepEqual(w.status, { in: ["pending", "active"] })
    assert.equal(w.deletedAt, null)
    // Цепочка денег: recalcClientDiscounts (клиент) + repriceSubscription (абонемент).
    assert.equal(calls.clientFindFirst.length, 1)
    assert.equal(calls.repriceFindFirst.length, 1)
  })

  it("занятие вне диапазона абонемента — ничего не обновляется", async () => {
    const { tx, calls } = makeTx({ subs: [minecraftSub] })
    const res = await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [utc(2026, 7, 2)], // раньше startDate 07.07
      removedDates: [],
      createdBy: null,
    })
    assert.equal(res.updated, 0)
    assert.equal(calls.subUpdate.length, 0)
    assert.equal(calls.clientFindFirst.length, 0)
  })

  it("удаление занятия: totalLessons 7 → 6, totalAmount 4500", async () => {
    const { tx, calls } = makeTx({ subs: [minecraftSub] })
    const res = await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [],
      removedDates: [utc(2026, 7, 28)],
      createdBy: null,
    })
    assert.equal(res.updated, 1)
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 6, totalAmount: 4500 })
  })

  it("legacy-скидка: finalAmount = totalAmount − discountAmount, balance = final − оплачено", async () => {
    const { tx, calls } = makeTx({
      subs: [{ ...minecraftSub, discountSource: "legacy", discountAmount: 200 }],
      paidSum: 5250,
    })
    await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [utc(2026, 7, 30)],
      removedDates: [],
      createdBy: null,
    })
    assert.deepEqual(calls.subUpdate[0].data, {
      totalLessons: 8,
      totalAmount: 6000,
      finalAmount: 5800, // 6000 − 200
      balance: 550, // 5800 − 5250
    })
    // Легаси не репрайсится (замороженная формула), но скидки клиента пересчитываются.
    assert.equal(calls.repriceFindFirst.length, 0)
    assert.equal(calls.clientFindFirst.length, 1)
    assert.equal(calls.paymentAggregate[0].where!.tenantId, "t")
    assert.equal(calls.paymentAggregate[0].where!.deletedAt, null)
  })

  it("несколько абонементов: дельта применяется каждому по его диапазону", async () => {
    // Второй абонемент стартует 20.07 — занятие 30.07 в его диапазоне тоже.
    const late = {
      ...minecraftSub,
      id: "s2",
      clientId: "c2",
      startDate: utc(2026, 7, 20),
      totalLessons: 3,
    }
    const { tx, calls } = makeTx({ subs: [minecraftSub, late] })
    const res = await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [utc(2026, 7, 30)],
      removedDates: [],
      createdBy: null,
    })
    assert.equal(res.updated, 2)
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 8, totalAmount: 6000 })
    assert.deepEqual(calls.subUpdate[1].data, { totalLessons: 4, totalAmount: 3000 })
    // recalcClientDiscounts — по разу на клиента (c1, c2).
    assert.equal(calls.clientFindFirst.length, 2)
  })

  it("кламп нуля: удаление двух занятий при totalLessons=1 даёт 0, не −1", async () => {
    const { tx, calls } = makeTx({ subs: [{ ...minecraftSub, totalLessons: 1 }] })
    await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [],
      removedDates: [utc(2026, 7, 21), utc(2026, 7, 28)],
      createdBy: null,
    })
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 0, totalAmount: 0 })
  })

  it("пустые списки дат: ни одного запроса в БД", async () => {
    const { tx, calls } = makeTx({ subs: [minecraftSub] })
    const res = await recalcSubscriptionsOnScheduleChange(tx as any, {
      tenantId: "t",
      groupId: "g",
      addedDates: [],
      removedDates: [],
      createdBy: null,
    })
    assert.equal(res.updated, 0)
    assert.equal(calls.subFindMany.length, 0)
  })
})
