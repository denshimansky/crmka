import { Prisma, type PrismaClient } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"
import { churnClientIfNoActiveSubscription } from "@/lib/clients/churn-on-withdrawal"
import { cleanPostWithdrawalEmptyAttendance } from "@/lib/subscriptions/deactivate-enrollment"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Финальная денежная сверка отчисления абонемента: перевод в `withdrawn` с
 * возвратом переплаты / переносом долга на баланс родителя.
 *
 * Это КАНОНИЧЕСКАЯ реализация сверки. Та же формула продублирована (по
 * историческим причинам, без риска переписывать рабочие денежные роуты) в
 * немедленных путях отчисления — PATCH `/api/subscriptions/[id]` и
 * POST `/api/subscriptions/[id]/refund`. При правке формулы держать в синхроне.
 *
 * Используется отложенным отчислением (Подход A): cron
 * `finalize-scheduled-withdrawals` на дату X+1 вызывает эту функцию для
 * абонементов с наступившей `scheduledWithdrawalDate`. К этому моменту занятия
 * до X уже отмечены и списаны по факту, поэтому сверка возвращает на баланс
 * ровно остаток за непосещённые/будущие занятия.
 *
 * delta = нетто-оплачено − Σ Attendance.chargeAmount − уже применённые сверки.
 *   delta > 0 → возврат на баланс; delta < 0 → долг на баланс; balance → 0.
 *
 * НЕ трогает GroupEnrollment — при отложенном отчислении зачисление
 * деактивируется в момент планирования (withdrawnAt = X+1).
 */
export async function applyWithdrawalSettlement(
  tx: Tx,
  params: {
    tenantId: string
    subscription: { id: string; clientId: string; directionId: string }
    withdrawalDate: Date
    withdrawalReasonId: string | null
    createdBy: string | null
  },
): Promise<{ balanceDelta: number }> {
  const { tenantId, subscription, withdrawalDate, withdrawalReasonId, createdBy } = params

  const paidToSub = await netPaidToSubscription(tx, tenantId, subscription.id)
  const usedAgg = await tx.attendance.aggregate({
    where: { tenantId, subscriptionId: subscription.id },
    _sum: { chargeAmount: true },
  })
  const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
  const priorAgg = await tx.clientBalanceTransaction.aggregate({
    where: { tenantId, subscriptionId: subscription.id, type: "subscription_closed_refund" },
    _sum: { amount: true },
  })
  const delta = paidToSub
    .minus(usedAmount)
    .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))

  if (!delta.isZero()) {
    await applyBalanceDelta(tx, {
      tenantId,
      clientId: subscription.clientId,
      delta,
      type: "subscription_closed_refund",
      refs: { subscriptionId: subscription.id, directionId: subscription.directionId },
      comment: delta.isPositive()
        ? `Отчисление по графику: возврат на баланс ${delta.toFixed(2)} ₽`
        : `Отчисление по графику: долг ${delta.abs().toFixed(2)} ₽`,
      createdBy,
    })
  }

  await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "withdrawn",
      balance: 0,
      withdrawalDate,
      withdrawalReasonId,
      // План исполнен — чистим, чтобы cron не подхватил абонемент повторно.
      scheduledWithdrawalDate: null,
      scheduledWithdrawalReasonId: null,
      scheduledWithdrawalComment: null,
    },
  })

  // Bug 2 (defense-in-depth для отложенного отчисления): подчистить «висящие»
  // пустые отметки на занятиях после границы выбытия. Зачисление деактивируется в
  // момент планирования (withdrawnAt = X+1); расписание после X ребёнка уже прячет,
  // поэтому новых отметок там быть не должно, но на всякий случай убираем возможные
  // остатки, чтобы реестр «Пропуски» и отчёты не показывали выбывшего.
  const subRow = await tx.subscription.findUnique({
    where: { id: subscription.id },
    select: { groupId: true, wardId: true },
  })
  if (subRow) {
    const enr = await tx.groupEnrollment.findFirst({
      where: {
        tenantId,
        groupId: subRow.groupId,
        clientId: subscription.clientId,
        wardId: subRow.wardId,
        isActive: false,
        withdrawnAt: { not: null },
        deletedAt: null,
      },
      orderBy: { withdrawnAt: "desc" },
      select: { withdrawnAt: true },
    })
    if (enr?.withdrawnAt) {
      await cleanPostWithdrawalEmptyAttendance(tx, {
        tenantId,
        groupId: subRow.groupId,
        clientId: subscription.clientId,
        wardId: subRow.wardId,
        cutoff: enr.withdrawnAt,
      })
    }
  }

  // Скидки v2: отчисленный выпадает из состава месяца — пересчёт скидок клиента.
  await recalcClientDiscounts(tx, { tenantId, clientId: subscription.clientId, createdBy })

  // Не осталось активных абонементов → клиент «Выбывший».
  await churnClientIfNoActiveSubscription(tx, tenantId, subscription.clientId, withdrawalDate)

  return { balanceDelta: delta.toNumber() }
}
