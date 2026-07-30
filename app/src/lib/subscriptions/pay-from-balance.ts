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
import { recordClientStatusChange } from "@/lib/clients/status-history"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { currencySymbol } from "@/lib/currency"

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

    const currency =
      (
        await t.organization.findUnique({
          where: { id: input.tenantId },
          select: { currency: true },
        })
      )?.currency ?? "RUB"
    const sym = currencySymbol(currency)

    const amt = new Prisma.Decimal(input.amount)
    const subBalance = new Prisma.Decimal(sub.balance)
    if (amt.greaterThan(subBalance)) {
      throw new PayFromBalanceError(
        400,
        `Сумма больше долга по абонементу (${subBalance.toFixed(2)} ${sym})`,
      )
    }

    const client = await t.client.findFirst({
      where: { id: sub.clientId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, clientBalance: true, funnelStatus: true, clientStatus: true },
    })
    if (!client) throw new PayFromBalanceError(404, "Клиент не найден")
    const clientBal = new Prisma.Decimal(client.clientBalance)
    if (amt.greaterThan(clientBal)) {
      throw new PayFromBalanceError(
        400,
        `Недостаточно средств на балансе родителя (${clientBal.toFixed(2)} ${sym})`,
      )
    }

    // accountId — техническая заглушка под NOT NULL-колонку: деньги по кассам
    // не двигаются, поэтому счёт у transfer_in в UI и кассовых отчётах не
    // отображается и в поступления не считается (Баг #3).
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
    // chargedAmount отражает только отработанные занятия (через Attendance),
    // не оплату. Оплата меняет balance и paid (через Payment.transfer_in).
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
        ...(becameActive ? { status: "active", activatedAt: new Date() } : {}),
      },
    })

    // Оплата абонемента (на ЛЮБУЮ сумму, не обязательно полную) переводит
    // клиента в «Активный клиент» — правило, согласованное с методологией:
    // покупка = актив. Простое пополнение баланса (/api/payments, вебхук ЮKassa)
    // статус НЕ меняет. Условие через ИЛИ — срабатывает, пока клиент не
    // полностью «active_client + active», поэтому заодно возвращает выбывшего
    // (Баг #5) и лечит рассинхрон. ЧС не трогаем: снимает только владелец.
    const notFullyActive =
      client.funnelStatus !== "active_client" || client.clientStatus !== "active"
    if (notFullyActive && client.funnelStatus !== "blacklisted") {
      await t.client.update({
        where: { id: sub.clientId },
        data: { funnelStatus: "active_client", clientStatus: "active", withdrawalDate: null },
      })
      await recordClientStatusChange(t, {
        tenantId: input.tenantId,
        clientId: sub.clientId,
        employeeId: input.createdBy,
        funnel: { old: client.funnelStatus, new: "active_client" },
        client: { old: client.clientStatus, new: "active" },
        reason: "subscription_payment",
      })
    }

    if (becameActive) {
      // Зачисление в группу → «оплачено» (и для взрослого абонемента wardId=null,
      // который не попадает в ward-ветку ниже).
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

    if (becameActive && sub.wardId) {
      // Заявка, по которой выписан этот абонемент, выиграна (оплачена) — уходит из
      // воронки (won). Остальные заявки ребёнка остаются. Матчим по направлению, а
      // если не нашли и у ребёнка ровно одна заявка в «Ожидаем оплату» — берём её.
      const wonData = {
        status: "processed" as const,
        processedToStatus: "won" as const,
        processedAt: new Date(),
        processedBy: input.createdBy ?? undefined,
      }
      const wonByDirection = await t.application.updateMany({
        where: {
          tenantId: input.tenantId,
          wardId: sub.wardId,
          directionId: sub.directionId,
          status: "active",
          stage: "awaiting_payment",
          deletedAt: null,
        },
        data: wonData,
      })
      if (wonByDirection.count === 0) {
        const awaiting = await t.application.findMany({
          where: {
            tenantId: input.tenantId,
            wardId: sub.wardId,
            status: "active",
            stage: "awaiting_payment",
            deletedAt: null,
          },
          select: { id: true },
        })
        if (awaiting.length === 1) {
          await t.application.update({ where: { id: awaiting[0].id }, data: wonData })
        }
      }
      // Зеркало Ward.salesStage пересчитываем по оставшимся активным заявкам.
      await recomputeWardSalesStage(t, input.tenantId, sub.wardId)
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
      newChargedAmount: Number(sub.chargedAmount),
      newClientBalance: new Prisma.Decimal(balanceRes.newBalance).toNumber(),
      becameActive,
    }
  })
}
