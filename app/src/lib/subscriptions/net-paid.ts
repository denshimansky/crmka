import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Нетто-«оплачено» абонемента: transfer_in (включая отрицательные сторно
 * скидок) плюс отрицательные refund — деньги, УНЕСЁННЫЕ с абонемента
 * (возврат из кассы, перенос баланса на другой абонемент).
 *
 * Считать «оплачено» только по transfer_in нельзя: при закрытии/аннулировании
 * уже унесённые переносом или возвратом деньги вернулись бы на баланс родителя
 * второй раз (адверсариальное ревью Бага #4). Формула идентична recomputeMoney
 * (см. lib/discounts/recalc-client-discounts.ts).
 */
export async function netPaidToSubscription(
  t: Tx,
  tenantId: string,
  subscriptionId: string,
): Promise<Prisma.Decimal> {
  const agg = await t.payment.aggregate({
    where: {
      tenantId,
      subscriptionId,
      deletedAt: null,
      OR: [{ type: "transfer_in" }, { type: "refund", amount: { lt: 0 } }],
    },
    _sum: { amount: true },
  })
  return new Prisma.Decimal(agg._sum.amount ?? 0)
}

/**
 * Батч-версия netPaidToSubscription для набора абонементов — один groupBy
 * вместо N запросов. Возвращает Map subscriptionId → нетто-«оплачено».
 * Абонементы без платежей в карте отсутствуют (трактовать как 0).
 */
export async function netPaidBySubscriptions(
  t: Tx,
  tenantId: string,
  subscriptionIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (subscriptionIds.length === 0) return new Map()
  const rows = await t.payment.groupBy({
    by: ["subscriptionId"],
    where: {
      tenantId,
      subscriptionId: { in: subscriptionIds },
      deletedAt: null,
      OR: [{ type: "transfer_in" }, { type: "refund", amount: { lt: 0 } }],
    },
    _sum: { amount: true },
  })
  const map = new Map<string, Prisma.Decimal>()
  for (const r of rows) {
    if (r.subscriptionId) map.set(r.subscriptionId, new Prisma.Decimal(r._sum.amount ?? 0))
  }
  return map
}

/**
 * «Оплачено» для показа в таблицах абонементов: нетто-платежи МИНУС знаковая
 * сверка закрытия (subscription_closed_refund).
 *
 * Сверка знаковая, и оба знака — движение реальных денег родителя:
 *   • +N — переплата вернулась на баланс родителя → «Оплачено» уменьшается;
 *   • −N — долг при закрытии/отчислении погашен с баланса родителя →
 *     «Оплачено» увеличивается: это тоже оплата, просто не ручная. Раньше
 *     считали только положительные и показывали одни ручные зачисления
 *     (22.08.2026: внесли 4000, при отчислении автосписали ещё 2000 —
 *     в столбце висело 4000 вместо 6000).
 *
 * Для закрытого/отчисленного результат по построению равен chargedAmount:
 * сверка закрытия приводит «оплачено» к отработанному. Если баланс родителя
 * при этом ушёл в минус — долг виден в «Долг/Баланс» (отрицательный
 * clientBalance), а не прячется в абонементе.
 *
 * Не путать с netPaidToSubscription: та считает деньги ДО сверки и служит
 * денежной логике закрытия (сверка вычитает прошлые проводки отдельно).
 */
export interface SubscriptionPaid {
  /** Итог для столбца «Оплачено». */
  paid: number
  /** Внесено до сверки закрытия (нетто-платежи). */
  netPaid: number
  /** Сверка закрытия: > 0 — вернули на баланс, < 0 — добрали с баланса. */
  closure: number
}

export async function paidBySubscriptions(
  t: Tx,
  tenantId: string,
  subscriptionIds: string[],
): Promise<Map<string, SubscriptionPaid>> {
  if (subscriptionIds.length === 0) return new Map()
  const [netPaid, closureRows] = await Promise.all([
    netPaidBySubscriptions(t, tenantId, subscriptionIds),
    t.clientBalanceTransaction.groupBy({
      by: ["subscriptionId"],
      where: {
        tenantId,
        subscriptionId: { in: subscriptionIds },
        type: "subscription_closed_refund",
      },
      _sum: { amount: true },
    }),
  ])
  const closureBySub = new Map<string, number>()
  for (const r of closureRows) {
    if (r.subscriptionId) closureBySub.set(r.subscriptionId, Number(r._sum.amount ?? 0))
  }

  const map = new Map<string, SubscriptionPaid>()
  for (const id of subscriptionIds) {
    const net = Number(netPaid.get(id) ?? 0)
    const closure = closureBySub.get(id) ?? 0
    map.set(id, { paid: net - closure, netPaid: net, closure })
  }
  return map
}
