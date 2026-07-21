/**
 * Unit-тесты closeSubscription (июль 2026, баг карточки Лескиной: закрытый
 * переплаченный абонемент не вернул переплату за «Уваж. пропуск»).
 *
 * Проверяем денежную сверку при закрытии и строку в историю клиента:
 *   - переплата (оплачено > списано) → возврат на баланс (subscription_closed_refund);
 *   - ровно (оплачено = списано) → без движения баланса;
 *   - долг (списано > оплачено) → минус баланса;
 *   - прошлые возвраты закрытия вычитаются (повторное закрытие безопасно);
 *   - уже closed/withdrawn — no-op.
 *
 * Чистая логика на мок-Tx (как consumed-lessons.test.ts). deactivate
 * короткозамыкаем через subscription.count>0, resolveAwaiting — через active-статус.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import { closeSubscription } from "../lib/subscriptions/close-subscription"

const D = (v: number | string) => new Prisma.Decimal(v)

interface MockOpts {
  sub?: Record<string, unknown> | null
  paid?: number
  used?: number
  prior?: number
}

function makeTx(opts: MockOpts) {
  const calls = {
    balanceTx: [] as any[],
    communication: [] as any[],
    subUpdate: [] as any[],
  }
  const sub =
    opts.sub === undefined
      ? {
          id: "s1",
          tenantId: "t",
          clientId: "c1",
          wardId: "w1",
          groupId: "g1",
          directionId: "d1",
          status: "active",
          activatedAt: new Date(Date.UTC(2026, 5, 1)),
          periodYear: 2026,
          periodMonth: 6,
          direction: { name: "Каллиграфия" },
        }
      : opts.sub
  const tx = {
    subscription: {
      findFirst: async () => sub,
      update: async (args: any) => {
        calls.subUpdate.push(args)
        return { id: args.where.id }
      },
      // otherLive>0 → deactivateGroupEnrollmentOnWithdrawal возвращает 0 сразу.
      count: async () => 1,
    },
    payment: { aggregate: async () => ({ _sum: { amount: D(opts.paid ?? 0) } }) },
    attendance: { aggregate: async () => ({ _sum: { chargeAmount: D(opts.used ?? 0) } }) },
    clientBalanceTransaction: {
      aggregate: async () => ({ _sum: { amount: D(opts.prior ?? 0) } }),
      create: async (args: any) => {
        calls.balanceTx.push(args)
        return { id: "bt1" }
      },
    },
    client: {
      update: async () => ({ clientBalance: D(0) }),
    },
    communication: {
      create: async (args: any) => {
        calls.communication.push(args)
        return { id: "co1" }
      },
    },
  }
  return { tx, calls }
}

describe("closeSubscription — денежная сверка + история", () => {
  it("переплата (кейс Лескиной: 8×450, 5 Был + 3 Уваж.) → возврат 1350 на баланс", async () => {
    const { tx, calls } = makeTx({ paid: 3600, used: 2250, prior: 0 })
    const res = await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })

    assert.equal(res.closed, true)
    assert.equal(res.balanceDelta, 1350)
    // Возврат на баланс родителя.
    assert.equal(calls.balanceTx.length, 1)
    assert.equal(calls.balanceTx[0].data.type, "subscription_closed_refund")
    assert.equal(Number(calls.balanceTx[0].data.amount), 1350)
    // Абонемент закрыт, endDate = последний день периода, balance обнулён.
    assert.equal(calls.subUpdate.length, 1)
    assert.equal(calls.subUpdate[0].data.status, "closed")
    assert.equal(Number(calls.subUpdate[0].data.balance), 0)
    assert.equal(
      (calls.subUpdate[0].data.endDate as Date).toISOString().slice(0, 10),
      "2026-06-30",
    )
    // Строка в историю.
    assert.equal(calls.communication.length, 1)
    assert.match(calls.communication[0].data.content, /закрыт\. Возврат на баланс родителя: 1350\.00 ₽\./)
  })

  it("ровно оплачено = списано → без движения баланса, история «без изменений»", async () => {
    const { tx, calls } = makeTx({ paid: 2250, used: 2250, prior: 0 })
    const res = await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })

    assert.equal(res.balanceDelta, 0)
    assert.equal(calls.balanceTx.length, 0, "нет транзакции баланса")
    assert.match(calls.communication[0].data.content, /закрыт\. Баланс без изменений\./)
  })

  it("долг (списано > оплачено) → минус баланса + история о долге", async () => {
    const { tx, calls } = makeTx({ paid: 0, used: 450, prior: 0 })
    const res = await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })

    assert.equal(res.balanceDelta, -450)
    assert.equal(Number(calls.balanceTx[0].data.amount), -450)
    assert.equal(calls.balanceTx[0].data.comment, "Закрытие: долг 450.00 ₽")
    assert.match(calls.communication[0].data.content, /Образовался долг: 450\.00 ₽\./)
  })

  it("прошлые возвраты закрытия вычитаются → повторное закрытие не двоит", async () => {
    // Оплачено 3600, списано 2250, но 1350 уже возвращены прошлым закрытием.
    const { tx, calls } = makeTx({ paid: 3600, used: 2250, prior: 1350 })
    const res = await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })

    assert.equal(res.balanceDelta, 0)
    assert.equal(calls.balanceTx.length, 0, "двойного возврата нет")
  })

  it("reprice уже вернул переплату (net-оплачено уменьшено сторно) → delta 0", async () => {
    // Пост-фикс: оплата 3600 − 3 сторно по 450 = net 2250 = списано → нет возврата.
    const { tx, calls } = makeTx({ paid: 2250, used: 2250, prior: 0 })
    await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
    assert.equal(calls.balanceTx.length, 0)
  })

  it("уже closed/withdrawn — no-op (balance не двигаем повторно)", async () => {
    for (const status of ["closed", "withdrawn"]) {
      const { tx, calls } = makeTx({
        sub: {
          id: "s1", tenantId: "t", clientId: "c1", wardId: "w1", groupId: "g1",
          directionId: "d1", status, activatedAt: new Date(Date.UTC(2026, 5, 1)),
          periodYear: 2026, periodMonth: 6, direction: { name: "Каллиграфия" },
        },
        paid: 3600, used: 2250,
      })
      const res = await closeSubscription(tx as any, { tenantId: "t", subscriptionId: "s1" })
      assert.equal(res.closed, false, `${status} не закрываем повторно`)
      assert.equal(calls.subUpdate.length, 0)
      assert.equal(calls.balanceTx.length, 0)
      assert.equal(calls.communication.length, 0)
    }
  })
})
