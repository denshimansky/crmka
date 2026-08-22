/**
 * Unit-тесты paidBySubscriptions (22.08.2026, кейс Козловой: в столбце
 * «Оплачено» августовского абонемента висело 4000 ₽ — ручное зачисление,
 * хотя при отчислении с баланса родителя автосписали ещё 2000 ₽ долга).
 *
 * «Оплачено» = нетто-платежи МИНУС знаковая сверка закрытия:
 *   • сверка > 0 (переплата вернулась на баланс) → «Оплачено» уменьшается;
 *   • сверка < 0 (долг погашен с баланса родителя) → увеличивается.
 *
 * Чистая логика на мок-Tx (по образцу consumed-lessons.test.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { paidBySubscriptions } from "../lib/subscriptions/net-paid"

const TENANT = "t1"

/**
 * Мок-Tx: payment.groupBy отдаёт нетто-платежи, clientBalanceTransaction.groupBy —
 * сверки закрытия. Заодно проверяем сами where-фильтры.
 */
function mockTx(
  payments: Record<string, number>,
  closures: Record<string, number>,
  seen?: { paymentWhere?: any; closureWhere?: any },
) {
  return {
    payment: {
      async groupBy(args: any) {
        if (seen) seen.paymentWhere = args.where
        return Object.entries(payments).map(([subscriptionId, amount]) => ({
          subscriptionId,
          _sum: { amount },
        }))
      },
    },
    clientBalanceTransaction: {
      async groupBy(args: any) {
        if (seen) seen.closureWhere = args.where
        return Object.entries(closures).map(([subscriptionId, amount]) => ({
          subscriptionId,
          _sum: { amount },
        }))
      },
    },
  } as any
}

describe("paidBySubscriptions", () => {
  it("живой абонемент: «Оплачено» = внесённые деньги", async () => {
    const map = await paidBySubscriptions(mockTx({ s1: 4000 }, {}), TENANT, ["s1"])
    assert.equal(map.get("s1")?.paid, 4000)
  })

  it("отчисление с возвратом переплаты: возврат вычитается", async () => {
    // Внесли 9000, отходил на 5000 → 4000 вернулись на баланс родителя.
    const map = await paidBySubscriptions(mockTx({ s1: 9000 }, { s1: 4000 }), TENANT, ["s1"])
    assert.equal(map.get("s1")?.paid, 5000)
  })

  it("отчисление с долгом: автосписание с баланса родителя — тоже оплата", async () => {
    // Внесли вручную 4000, отходил на 6000 → 2000 автосписаны с баланса.
    const map = await paidBySubscriptions(mockTx({ s1: 4000 }, { s1: -2000 }), TENANT, ["s1"])
    assert.equal(map.get("s1")?.paid, 6000)
    // Разбивка для подсказки: внесено 4000, сверка −2000.
    assert.equal(map.get("s1")?.netPaid, 4000)
    assert.equal(map.get("s1")?.closure, -2000)
  })

  it("абонемент без платежей и сверок → 0 (в карте есть все запрошенные id)", async () => {
    const map = await paidBySubscriptions(mockTx({}, {}), TENANT, ["s1", "s2"])
    assert.equal(map.get("s1")?.paid, 0)
    assert.equal(map.get("s2")?.paid, 0)
    assert.equal(map.size, 2)
  })

  it("батч: каждый абонемент считается независимо", async () => {
    const map = await paidBySubscriptions(
      mockTx({ s1: 9000, s2: 4000, s3: 3000 }, { s1: 4000, s2: -2000 }),
      TENANT,
      ["s1", "s2", "s3"],
    )
    assert.equal(map.get("s1")?.paid, 5000)
    assert.equal(map.get("s2")?.paid, 6000)
    assert.equal(map.get("s3")?.paid, 3000)
  })

  it("пустой список — без запросов в БД", async () => {
    const seen: { paymentWhere?: any; closureWhere?: any } = {}
    const map = await paidBySubscriptions(mockTx({ s1: 1 }, { s1: 1 }, seen), TENANT, [])
    assert.equal(map.size, 0)
    assert.equal(seen.paymentWhere, undefined)
    assert.equal(seen.closureWhere, undefined)
  })

  it("фильтры: только свой тенант, живые платежи, сверки обоих знаков", async () => {
    const seen: { paymentWhere?: any; closureWhere?: any } = {}
    await paidBySubscriptions(mockTx({}, {}, seen), TENANT, ["s1"])
    assert.equal(seen.paymentWhere.tenantId, TENANT)
    assert.equal(seen.paymentWhere.deletedAt, null)
    assert.deepEqual(seen.paymentWhere.OR, [
      { type: "transfer_in" },
      { type: "refund", amount: { lt: 0 } },
    ])
    assert.equal(seen.closureWhere.tenantId, TENANT)
    assert.equal(seen.closureWhere.type, "subscription_closed_refund")
    // Знак сверки НЕ фильтруется: минус — это оплата долга с баланса родителя.
    assert.equal(seen.closureWhere.amount, undefined)
  })
})
