import type { Prisma } from "@prisma/client"
import { recomputeWardSalesStage } from "./ward-sales-stage"

/**
 * Вывод одной заявки из воронки продаж. Общая логика для:
 *  - POST /api/applications/[id]/remove-from-funnel («Удалить» в /crm/sales);
 *  - DELETE /api/applications/[id] (удаление заявки из карточки клиента).
 *
 * Делает:
 *  1) отменяет ЗАПЛАНИРОВАННЫЕ пробные этой заявки (attended/no_show — история, не трогаем);
 *  2) soft-delete заявки (deletedAt + status='processed');
 *  3) если у клиента не осталось будущих запланированных пробных — закрывает
 *     автозадачи-напоминания о пробном (иначе становятся фантомными);
 *  4) пересчитывает зеркало Ward.salesStage по оставшимся активным заявкам.
 *
 * Возвращает число отменённых пробных.
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
): Promise<{ cancelledTrials: number }> {
  const { tenantId, applicationId, wardId, clientId } = opts
  const now = opts.at ?? new Date()

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

  // 3. Закрыть фантомные автозадачи-напоминания, если пробных у клиента не осталось.
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

  // 4. Пересчитать зеркало Ward.salesStage.
  await recomputeWardSalesStage(tx, tenantId, wardId, now)

  return { cancelledTrials: cancelledTrials.count }
}
