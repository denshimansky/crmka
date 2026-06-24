import type { Prisma } from "@prisma/client"
import { recomputeWardSalesStage } from "./ward-sales-stage"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"

/**
 * Вывод одной заявки из воронки продаж. Общая логика для:
 *  - POST /api/applications/[id]/remove-from-funnel («Удалить» в /crm/sales);
 *  - DELETE /api/applications/[id] (удаление заявки из карточки клиента).
 *
 * Делает:
 *  1) отменяет ЗАПЛАНИРОВАННЫЕ пробные этой заявки (attended/no_show — история, не трогаем);
 *  2) soft-delete заявки (deletedAt + status='processed');
 *  3) баг #51: если заявка была в «Ожидаем оплату» — удаляет (soft) выписанный по
 *     ней pending-абонемент, чтобы он не висел в истории абонементов и отчётах;
 *  4) если у клиента не осталось будущих запланированных пробных — закрывает
 *     автозадачи-напоминания о пробном (иначе становятся фантомными);
 *  5) пересчитывает зеркало Ward.salesStage по оставшимся активным заявкам.
 *
 * Возвращает число отменённых пробных и удалённых абонементов.
 */
export async function removeApplicationFromFunnel(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    applicationId: string
    wardId: string
    clientId: string
    employeeId?: string | null
    at?: Date
  },
): Promise<{ cancelledTrials: number; deletedSubscriptions: number }> {
  const { tenantId, applicationId, wardId, clientId } = opts
  const now = opts.at ?? new Date()

  // Этап и направление заявки нужны до её soft-delete: по awaiting_payment-заявке
  // был выписан pending-абонемент, который тоже надо аннулировать (баг #51).
  const app = await tx.application.findFirst({
    where: { id: applicationId, tenantId },
    select: { stage: true, directionId: true },
  })

  // 1. Отменить запланированные пробные этой заявки.
  const cancelledTrials = await tx.trialLesson.updateMany({
    where: { tenantId, applicationId, status: "scheduled" },
    data: { status: "cancelled" },
  })

  // 2. Soft-delete самой заявки.
  await tx.application.update({
    where: { id: applicationId },
    data: { deletedAt: now, status: "processed" },
  })

  // 3. Баг #51: аннулировать pending-абонемент, выписанный по этой заявке в
  // «Ожидаем оплату». Привязка ward+направление — та же, что использует страница
  // «Продажи» для связи заявки и абонемента (move-to-awaiting-payment не хранит
  // прямую ссылку). Удаляем только «чистые» pending: без оплат и списаний за
  // занятия — абонемент с деньгами/посещениями нужно отчислять, а не удалять
  // (иначе оплаченное/отхоженное повисло бы в воздухе), такой оставляем как есть.
  let deletedSubscriptions = 0
  if (app?.stage === "awaiting_payment" && app.directionId) {
    const pendingSubs = await tx.subscription.findMany({
      where: {
        tenantId,
        wardId,
        directionId: app.directionId,
        status: "pending",
        deletedAt: null,
      },
      select: {
        id: true,
        groupId: true,
        clientId: true,
        wardId: true,
        chargedAmount: true,
      },
    })

    for (const sub of pendingSubs) {
      const [paymentsCount, attendedCount] = await Promise.all([
        tx.payment.count({
          where: { tenantId, subscriptionId: sub.id, deletedAt: null },
        }),
        tx.attendance.count({
          where: {
            tenantId,
            subscriptionId: sub.id,
            isPending: false,
            attendanceType: { chargesSubscription: true },
          },
        }),
      ])
      if (paymentsCount > 0 || attendedCount > 0 || Number(sub.chargedAmount) > 0) continue

      await tx.subscription.update({
        where: { id: sub.id },
        data: { deletedAt: now },
      })
      deletedSubscriptions++

      // Зачисление awaiting_payment: убираем ребёнка из группы, если в ней не
      // осталось другого живого абонемента (иначе исчез бы оплаченный месяц).
      await deactivateGroupEnrollmentOnWithdrawal(tx, {
        tenantId,
        groupId: sub.groupId,
        clientId: sub.clientId,
        wardId: sub.wardId,
        excludeSubscriptionId: sub.id,
      })

      // Счётчик абонементов клиента инкрементился при выписке — возвращаем назад.
      await tx.client.update({
        where: { id: sub.clientId },
        data: { totalSubscriptionsCount: { decrement: 1 } },
      })
    }

    // Удалённый pending выпадает из состава месяца — пересчёт скидок остальных
    // абонементов клиента (мог смениться «самый дорогой»).
    if (deletedSubscriptions > 0) {
      await recalcClientDiscounts(tx, {
        tenantId,
        clientId,
        createdBy: opts.employeeId ?? null,
      })
    }
  }

  // 4. Закрыть фантомные автозадачи-напоминания, если пробных у клиента не осталось.
  const remainingScheduled = await tx.trialLesson.count({
    where: { tenantId, clientId, status: "scheduled" },
  })
  if (remainingScheduled === 0) {
    await tx.task.updateMany({
      where: {
        tenantId,
        clientId,
        autoTrigger: "trial_reminder",
        status: "pending",
        deletedAt: null,
      },
      data: {
        status: "completed",
        completedAt: now,
        completedBy: opts.employeeId ?? undefined,
      },
    })
  }

  // 5. Пересчитать зеркало Ward.salesStage.
  await recomputeWardSalesStage(tx, tenantId, wardId, now)

  return { cancelledTrials: cancelledTrials.count, deletedSubscriptions }
}
