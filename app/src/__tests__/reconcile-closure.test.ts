/**
 * Unit-тесты reconcileSubscriptionClosure (август 2026, баг ДЦ Первое Слово:
 * крон close-expired-packages закрывал пакет, оставляя долг «мёртвым» на
 * абонементе — balance>0 на closed, который нельзя ни оплатить, ни исправить).
 *
 * Единая формула сверки: delta = нетто-оплачено − списано − прошлые возвраты.
 *   - штатное закрытие (burnOverpayment=false): переплата → возврат, долг → минус;
 *   - пакет (burnOverpayment=true): долг → минус, переплата СГОРАЕТ (возврата нет).
 *
 * Чистая логика на мок-Tx (как close-subscription.test.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import { reconcileSubscriptionClosure } from "../lib/subscriptions/reconcile-closure"

const D = (v: number | string) => new Prisma.Decimal(v)

interface MockOpts {
  paid?: number
  used?: number
  prior?: number
}

function makeTx(opts: MockOpts) {
  const calls = { balanceTx: [] as any[] }
  const tx = {
    payment: { aggregate: async () => ({ _sum: { amount: D(opts.paid ?? 0) } }) },
    attendance: { aggregate: async () => ({ _sum: { chargeAmount: D(opts.used ?? 0) } }) },
    clientBalanceTransaction: {
      aggregate: async () => ({ _sum: { amount: D(opts.prior ?? 0) } }),
      create: async (args: any) => {
        calls.balanceTx.push(args)
        return { id: "bt1" }
      },
    },
    client: { update: async () => ({ clientBalance: D(0) }) },
  }
  return { tx, calls }
}

const base = {
  tenantId: "t",
  subscriptionId: "s1",
  clientId: "c1",
  directionId: "d1",
}

describe("reconcileSubscriptionClosure — штатное закрытие (burnOverpayment=false)", () => {
  it("переплата (оплачено > списано) → возврат на баланс родителя", async () => {
    const { tx, calls } = makeTx({ paid: 3600, used: 2250 })
    const res = await reconcileSubscriptionClosure(tx as any, base)

    assert.equal(res.delta.toNumber(), 1350)
    assert.equal(Number(res.netPaid), 3600)
    assert.equal(calls.balanceTx.length, 1)
    assert.equal(calls.balanceTx[0].data.type, "subscription_closed_refund")
    assert.equal(Number(calls.balanceTx[0].data.amount), 1350)
    assert.equal(calls.balanceTx[0].data.subscriptionId, "s1")
    assert.equal(calls.balanceTx[0].data.directionId, "d1")
    assert.match(calls.balanceTx[0].data.comment, /Закрытие: возврат на баланс 1350\.00 ₽/)
  })

  it("долг (списано > оплачено) → минус баланса", async () => {
    const { tx, calls } = makeTx({ paid: 0, used: 450 })
    const res = await reconcileSubscriptionClosure(tx as any, base)

    assert.equal(res.delta.toNumber(), -450)
    assert.equal(Number(calls.balanceTx[0].data.amount), -450)
    assert.equal(calls.balanceTx[0].data.comment, "Закрытие: долг 450.00 ₽")
  })

  it("ровно оплачено = списано → без движения баланса", async () => {
    const { tx, calls } = makeTx({ paid: 2250, used: 2250 })
    const res = await reconcileSubscriptionClosure(tx as any, base)
    assert.equal(res.delta.toNumber(), 0)
    assert.equal(calls.balanceTx.length, 0)
  })

  it("прошлые возвраты закрытия вычитаются → повторная сверка не двоит", async () => {
    const { tx, calls } = makeTx({ paid: 3600, used: 2250, prior: 1350 })
    const res = await reconcileSubscriptionClosure(tx as any, base)
    assert.equal(res.delta.toNumber(), 0)
    assert.equal(calls.balanceTx.length, 0)
  })
})

describe("reconcileSubscriptionClosure — пакет (burnOverpayment=true)", () => {
  const pkg = { ...base, burnOverpayment: true }

  it("фантом (не оплачен, не отработан) → delta 0, balance-проводок нет", async () => {
    // Кейс ДЦ Первое Слово 901c750b: paid=0, used=0, finalAmount 1350.
    const { tx, calls } = makeTx({ paid: 0, used: 0 })
    const res = await reconcileSubscriptionClosure(tx as any, pkg)
    assert.equal(res.delta.toNumber(), 0)
    assert.equal(calls.balanceTx.length, 0, "родителю ничего не списываем — долга по факту нет")
  })

  it("реальный долг (ходил, не доплатил) → минус баланса", async () => {
    // Пакет 4×1350, отработано 3 (4050), оплачен 1 (1350) → долг 2700.
    const { tx, calls } = makeTx({ paid: 1350, used: 4050 })
    const res = await reconcileSubscriptionClosure(tx as any, pkg)
    assert.equal(res.delta.toNumber(), -2700)
    assert.equal(calls.balanceTx.length, 1)
    assert.equal(Number(calls.balanceTx[0].data.amount), -2700)
    assert.equal(calls.balanceTx[0].data.type, "subscription_closed_refund")
    assert.equal(calls.balanceTx[0].data.comment, "Закрытие: долг 2700.00 ₽")
  })

  it("переплата пакета СГОРАЕТ → возврата на баланс нет (в отличие от календарного)", async () => {
    // Оплачено 4×1350, отработано 2 → переплата 2700 сгорает, НЕ возвращается.
    const { tx, calls } = makeTx({ paid: 5400, used: 2700 })
    const res = await reconcileSubscriptionClosure(tx as any, pkg)
    assert.equal(res.delta.toNumber(), 2700, "delta считается, но не проводится")
    assert.equal(calls.balanceTx.length, 0, "переплата пакета сгорает — возврата нет")
  })

  it("долг пакета идемпотентен: прошлый возврат покрыл разницу → delta 0", async () => {
    const { tx, calls } = makeTx({ paid: 1350, used: 4050, prior: -2700 })
    const res = await reconcileSubscriptionClosure(tx as any, pkg)
    assert.equal(res.delta.toNumber(), 0)
    assert.equal(calls.balanceTx.length, 0)
  })
})
