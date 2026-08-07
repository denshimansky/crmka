import { Prisma } from "@prisma/client"
import { currencySymbol } from "@/lib/currency"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"

type Tx = Prisma.TransactionClient

export interface ReconcileClosureInput {
  tenantId: string
  subscriptionId: string
  clientId: string
  directionId: string
  employeeId?: string | null
  /** ISO-код валюты организации для символа в комментарии проводки. По умолчанию RUB. */
  currency?: string
  /**
   * Правило пакетов «переплата сгорает»: при delta > 0 НИЧЕГО не возвращаем на
   * баланс родителя (по умолчанию false — штатный возврат переплаты, как в
   * закрытии/отчислении календарных). Долг (delta < 0) переносится на баланс
   * ВСЕГДА, независимо от флага.
   */
  burnOverpayment?: boolean
}

export interface ReconcileClosureResult {
  /** Знаковая дельта: + переплата, − долг, 0 — без движения. */
  delta: Prisma.Decimal
  /** Нетто-«оплачено» абонемента (для resolveAwaiting и т.п. — чтобы не считать дважды). */
  netPaid: Prisma.Decimal
}

/**
 * Денежная сверка при завершении абонемента — единая точка формулы
 * «оплачено − списано − уже применённые возвраты закрытия».
 *
 *   delta > 0 → переплата: возврат на баланс родителя (subscription_closed_refund),
 *               КРОМЕ случая burnOverpayment (пакет — остаток сгорает);
 *   delta < 0 → долг (клиент ходил, не доплатив) → уходит в минус баланса;
 *   delta = 0 → без движения.
 *
 * Вычитание прошлых subscription_closed_refund делает повторную сверку
 * идемпотентной (деньги не двигаются дважды при повторном закрытии/реактивации).
 *
 * Баланс НЕ обновляется, когда burnOverpayment && delta ≥ 0. Сам статус/balance
 * абонемента здесь не трогаем — это ответственность вызывающего.
 */
export async function reconcileSubscriptionClosure(
  tx: Tx,
  input: ReconcileClosureInput,
): Promise<ReconcileClosureResult> {
  const netPaid = await netPaidToSubscription(tx, input.tenantId, input.subscriptionId)
  const usedAgg = await tx.attendance.aggregate({
    where: { tenantId: input.tenantId, subscriptionId: input.subscriptionId },
    _sum: { chargeAmount: true },
  })
  const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
  const priorAgg = await tx.clientBalanceTransaction.aggregate({
    where: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      type: "subscription_closed_refund",
    },
    _sum: { amount: true },
  })
  const delta = netPaid
    .minus(usedAmount)
    .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))

  // Пакет: переплату (delta > 0) не возвращаем — сгорает. Долг переносим всегда.
  const skipRefund = input.burnOverpayment === true && !delta.isNegative()
  if (!delta.isZero() && !skipRefund) {
    const sym = currencySymbol(input.currency ?? "RUB")
    await applyBalanceDelta(tx, {
      tenantId: input.tenantId,
      clientId: input.clientId,
      delta,
      type: "subscription_closed_refund",
      refs: { subscriptionId: input.subscriptionId, directionId: input.directionId },
      comment: delta.isPositive()
        ? `Закрытие: возврат на баланс ${delta.toFixed(2)} ${sym}`
        : `Закрытие: долг ${delta.abs().toFixed(2)} ${sym}`,
      createdBy: input.employeeId ?? null,
    })
  }

  return { delta, netPaid }
}
