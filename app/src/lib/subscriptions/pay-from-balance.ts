// Списание с баланса родителя в счёт конкретного абонемента.
//
// Создаёт Payment type=transfer_in (ДДС не задет, в P&L попадает, в карточке
// абона видна строка платежа), уменьшает Subscription.balance, увеличивает
// chargedAmount, при полной оплате pending → active. На стороне родителя —
// applyBalanceDelta(type=transfer_to_subscription).
//
// Единственный путь списания денег с баланса родителя в счёт абонемента —
// кнопка «Оплатить с баланса» в карточке абонемента (POST /api/subscriptions/[id]/pay-from-balance).
// Поступление денег (/api/payments, webhook ЮKassa) на абонемент НЕ списывает.

import { db } from "@/lib/db"
import { Prisma, type PrismaClient } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"

type Tx = Prisma.TransactionClient | PrismaClient

export interface PayFromBalanceInput {
  tenantId: string
  subscriptionId: string
  amount: number
  createdBy: string | null
  /** Опциональный коммент для Payment. По умолчанию «Оплата с баланса родителя». */
  comment?: string
}

export interface PayFromBalanceResult {
  paymentId: string
  subscriptionId: string
  amount: number
  newSubscriptionBalance: number
  newChargedAmount: number
  newClientBalance: number
  becameActive: boolean
}

export class PayFromBalanceError extends Error {
  constructor(public httpStatus: number, message: string) {
    super(message)
  }
}

/**
 * Идемпотентно списывает `amount` с Client.clientBalance в Subscription.balance.
 * Если передан `tx` — работает внутри уже открытой транзакции (используется в
 * POST /api/payments при distribution[]). Иначе открывает свою.
 */
export async function payFromBalance(
  input: PayFromBalanceInput,
  tx?: Tx,
): Promise<PayFromBalanceResult> {
  const runner = (cb: (t: Tx) => Promise<PayFromBalanceResult>) =>
    tx ? cb(tx) : db.$transaction(cb)

  return runner(async (t) => {
    if (!(input.amount > 0)) {
      throw new PayFromBalanceError(400, "Сумма должна быть больше 0")
    }
    const sub = await t.subscription.findFirst({
      where: {
        id: input.subscriptionId,
        tenantId: input.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        clientId: true,
        wardId: true,
        groupId: true,
        directionId: true,
        status: true,
        balance: true,
        chargedAmount: true,
      },
    })
    if (!sub) throw new PayFromBalanceError(404, "Абонемент не найден")
    if (sub.status === "closed" || sub.status === "withdrawn") {
      throw new PayFromBalanceError(
        400,
        "Нельзя оплачивать закрытый или отчисленный абонемент",
      )
    }

    const amt = new Prisma.Decimal(input.amount)
    const subBalance = new Prisma.Decimal(sub.balance)
    if (amt.greaterThan(subBalance)) {
      throw new PayFromBalanceError(
        400,
        `Сумма больше долга по абонементу (${subBalance.toFixed(2)} ₽)`,
      )
    }

    const client = await t.client.findFirst({
      where: { id: sub.clientId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, clientBalance: true },
    })
    if (!client) throw new PayFromBalanceError(404, "Клиент не найден")
    const clientBal = new Prisma.Decimal(client.clientBalance)
    if (amt.greaterThan(clientBal)) {
      throw new PayFromBalanceError(
        400,
        `Недостаточно средств на балансе родителя (${clientBal.toFixed(2)} ₽)`,
      )
    }

    const account = await t.financialAccount.findFirst({
      where: {
        tenantId: input.tenantId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    if (!account) {
      throw new PayFromBalanceError(
        400,
        "Нет активного счёта. Создайте хотя бы одну кассу",
      )
    }

    const newSubBalance = subBalance.minus(amt)
    const newCharged = new Prisma.Decimal(sub.chargedAmount).plus(amt)
    const becameActive = sub.status === "pending" && newSubBalance.isZero()

    const payment = await t.payment.create({
      data: {
        tenantId: input.tenantId,
        clientId: sub.clientId,
        subscriptionId: sub.id,
        accountId: account.id,
        amount: amt,
        type: "transfer_in",
        method: "bank_transfer",
        date: new Date(),
        comment: input.comment ?? "Оплата с баланса родителя",
        createdBy: input.createdBy,
      },
      select: { id: true },
    })

    await t.subscription.update({
      where: { id: sub.id },
      data: {
        balance: newSubBalance,
        chargedAmount: newCharged,
        ...(becameActive ? { status: "active", activatedAt: new Date() } : {}),
      },
    })

    if (becameActive && sub.wardId) {
      await t.ward.update({
        where: { id: sub.wardId },
        data: { salesStage: "none", salesStageAt: new Date() },
      })
      await t.groupEnrollment.updateMany({
        where: {
          tenantId: input.tenantId,
          groupId: sub.groupId,
          clientId: sub.clientId,
          wardId: sub.wardId,
          isActive: true,
        },
        data: { paymentStatus: "active" },
      })
    }

    const balanceRes = await applyBalanceDelta(t, {
      tenantId: input.tenantId,
      clientId: sub.clientId,
      delta: amt.negated(),
      type: "transfer_to_subscription",
      refs: {
        subscriptionId: sub.id,
        paymentId: payment.id,
        directionId: sub.directionId,
      },
      comment: input.comment ?? "Оплата с баланса родителя",
      createdBy: input.createdBy,
    })

    return {
      paymentId: payment.id,
      subscriptionId: sub.id,
      amount: amt.toNumber(),
      newSubscriptionBalance: newSubBalance.toNumber(),
      newChargedAmount: newCharged.toNumber(),
      newClientBalance: new Prisma.Decimal(balanceRes.newBalance).toNumber(),
      becameActive,
    }
  })
}
