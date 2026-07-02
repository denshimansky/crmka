/**
 * Unit-тесты пересчёта календарного абонемента под дату отложенного отчисления.
 *
 * prorationRange — чистая функция границ (тип/период/startDate/клэмп);
 * prorateScheduledWithdrawal — оркестрация с мок-Tx: счёт занятий, обновление
 * totalLessons/totalAmount, legacy-формула, guard по статусу. repriceSubscription
 * внутри no-op'ится: мок subscription.findFirst возвращает null.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  prorationRange,
  prorateScheduledWithdrawal,
} from "../lib/subscriptions/prorate-scheduled-withdrawal"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

const julySub = {
  id: "s1",
  groupId: "g",
  type: "calendar",
  status: "pending",
  startDate: utc(2026, 7, 1),
  endDate: utc(2026, 7, 31),
  periodYear: 2026,
  periodMonth: 7,
  totalLessons: 9,
  lessonPrice: 450,
  discountAmount: 0,
  discountSource: "none",
}

describe("prorationRange", () => {
  it("отчисление 15.07: от начала периода по конец дня 15-го включительно", () => {
    const r = prorationRange(julySub, utc(2026, 7, 15))
    assert.ok(r)
    assert.equal(r.from.getTime(), utc(2026, 7, 1).getTime())
    assert.equal(r.to.getTime(), Date.UTC(2026, 6, 15, 23, 59, 59))
  })

  it("until=null (отмена плана): полный период", () => {
    const r = prorationRange(julySub, null)
    assert.ok(r)
    assert.equal(r.to.getTime(), Date.UTC(2026, 6, 31, 23, 59, 59))
  })

  it("startDate в середине месяца: from = startDate, а не начало периода", () => {
    const r = prorationRange({ ...julySub, startDate: utc(2026, 7, 10) }, utc(2026, 7, 20))
    assert.ok(r)
    assert.equal(r.from.getTime(), utc(2026, 7, 10).getTime())
  })

  it("until позже конца периода — клэмпится к periodEnd", () => {
    const r = prorationRange(julySub, utc(2026, 8, 5))
    assert.ok(r)
    assert.equal(r.to.getTime(), Date.UTC(2026, 6, 31, 23, 59, 59))
  })

  it("endDate=NULL (импортированные календарные): конец периода из period_year/month", () => {
    const r = prorationRange({ ...julySub, endDate: null }, null)
    assert.ok(r)
    assert.equal(r.to.getTime(), Date.UTC(2026, 6, 31, 23, 59, 59))
  })

  it("пакетный тип / нет периода — не применимо", () => {
    assert.equal(prorationRange({ ...julySub, type: "package" }, utc(2026, 7, 15)), null)
    assert.equal(prorationRange({ ...julySub, periodYear: null, periodMonth: null }, null), null)
  })

  it("until раньше startDate — пустой диапазон, null", () => {
    assert.equal(
      prorationRange({ ...julySub, startDate: utc(2026, 7, 20) }, utc(2026, 7, 10)),
      null,
    )
  })
})

type AnyArgs = { where: Record<string, any>; data?: Record<string, any>; _sum?: any }

function makeTx(opts: { lessonCount: number; paidSum?: number }) {
  const calls = {
    lessonCount: [] as AnyArgs[],
    subUpdate: [] as AnyArgs[],
    paymentAggregate: [] as AnyArgs[],
  }
  const tx = {
    lesson: {
      count: async (args: AnyArgs) => {
        calls.lessonCount.push(args)
        return opts.lessonCount
      },
    },
    subscription: {
      update: async (args: AnyArgs) => {
        calls.subUpdate.push(args)
        return {}
      },
      // repriceSubscription первым делом читает абонемент: null → ранний выход,
      // мокать всю цепочку скидок не нужно.
      findFirst: async () => null,
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

describe("prorateScheduledWithdrawal", () => {
  it("15.07 при 4 занятиях до X: totalLessons=4, totalAmount=1800", async () => {
    const { tx, calls } = makeTx({ lessonCount: 4 })
    const res = await prorateScheduledWithdrawal(tx as any, {
      tenantId: "t",
      subscription: julySub,
      until: utc(2026, 7, 15),
      createdBy: null,
    })
    assert.deepEqual(res, { changed: true, totalLessons: 4 })
    assert.equal(calls.subUpdate.length, 1)
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 4, totalAmount: 1800 })
    // Счёт занятий: та же группа, без отменённых, границы диапазона.
    const w = calls.lessonCount[0].where
    assert.equal(w.tenantId, "t")
    assert.equal(w.groupId, "g")
    assert.deepEqual(w.status, { not: "cancelled" })
    assert.equal((w.date.gte as Date).getTime(), utc(2026, 7, 1).getTime())
    assert.equal((w.date.lte as Date).getTime(), Date.UTC(2026, 6, 15, 23, 59, 59))
  })

  it("занятий в диапазоне нет (расписание не сгенерировано) — деньги не трогаем", async () => {
    const { tx, calls } = makeTx({ lessonCount: 0 })
    const res = await prorateScheduledWithdrawal(tx as any, {
      tenantId: "t",
      subscription: julySub,
      until: utc(2026, 7, 15),
      createdBy: null,
    })
    assert.equal(res.changed, false)
    assert.equal(calls.subUpdate.length, 0)
  })

  it("число занятий не изменилось — no-op", async () => {
    const { tx, calls } = makeTx({ lessonCount: 9 })
    const res = await prorateScheduledWithdrawal(tx as any, {
      tenantId: "t",
      subscription: julySub,
      until: null,
      createdBy: null,
    })
    assert.equal(res.changed, false)
    assert.equal(calls.subUpdate.length, 0)
  })

  it("guard по статусу: withdrawn/closed не пересчитываются", async () => {
    for (const status of ["withdrawn", "closed"]) {
      const { tx, calls } = makeTx({ lessonCount: 4 })
      const res = await prorateScheduledWithdrawal(tx as any, {
        tenantId: "t",
        subscription: { ...julySub, status },
        until: utc(2026, 7, 15),
        createdBy: null,
      })
      assert.equal(res.changed, false, status)
      assert.equal(calls.subUpdate.length, 0, status)
      assert.equal(calls.lessonCount.length, 0, status)
    }
  })

  it("legacy: finalAmount = totalAmount − discountAmount, balance = final − оплачено", async () => {
    const { tx, calls } = makeTx({ lessonCount: 4, paidSum: 1000 })
    const res = await prorateScheduledWithdrawal(tx as any, {
      tenantId: "t",
      subscription: { ...julySub, discountSource: "legacy", discountAmount: 200 },
      until: utc(2026, 7, 15),
      createdBy: null,
    })
    assert.equal(res.changed, true)
    assert.deepEqual(calls.subUpdate[0].data, {
      totalLessons: 4,
      totalAmount: 1800,
      finalAmount: 1600, // 1800 − 200
      balance: 600, // 1600 − 1000
    })
    // Оплаты считаются в границах tenant (изоляция на app-layer).
    assert.equal(calls.paymentAggregate[0].where.tenantId, "t")
    assert.equal(calls.paymentAggregate[0].where.deletedAt, null)
  })

  it("отмена плана (until=null): восстановление на полный период", async () => {
    const { tx, calls } = makeTx({ lessonCount: 9 })
    const res = await prorateScheduledWithdrawal(tx as any, {
      tenantId: "t",
      subscription: { ...julySub, totalLessons: 4 }, // был пересчитан на 4
      until: null,
      createdBy: null,
    })
    assert.deepEqual(res, { changed: true, totalLessons: 9 })
    assert.deepEqual(calls.subUpdate[0].data, { totalLessons: 9, totalAmount: 4050 })
  })
})
