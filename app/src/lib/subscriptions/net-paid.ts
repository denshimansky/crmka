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
