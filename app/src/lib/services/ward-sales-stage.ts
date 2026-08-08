import { Prisma, WardSalesStage } from "@prisma/client"

// Приоритет этапов воронки для зеркала Ward.salesStage.
const STAGE_PRIORITY: Record<WardSalesStage, number> = {
  none: 0,
  application: 1,
  trial_scheduled: 2,
  trial_attended: 3,
  awaiting_payment: 4,
}

/**
 * Пересчитывает денормализованное зеркало Ward.salesStage = максимальный этап среди
 * АКТИВНЫХ (status='active', не удалённых) заявок ребёнка. Если активных заявок нет —
 * 'none'. Источник истины воронки теперь Application.stage; зеркало нужно дашборду,
 * отчётам, контактам и автозадачам, которые читают Ward.salesStage.
 *
 * Вызывать ВНУТРИ транзакции после любого перехода заявки. salesStageAt обновляется
 * только при реальной смене этапа (как было в старой логике — отчёт воронки на него опирается).
 *
 * Побочный эффект: при ВЫХОДЕ ребёнка из awaiting_payment (оплата / разрешение /
 * удаление из воронки — все эти пути зовут recompute), если у родителя не осталось
 * детей в awaiting_payment, автозакрываем открытую задачу «Напомнить об оплате»
 * (autoTrigger=payment_due) — «одна задача до оплаты» больше не нужна.
 */
export async function recomputeWardSalesStage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  wardId: string,
  at: Date = new Date(),
): Promise<WardSalesStage> {
  const apps = await tx.application.findMany({
    where: { tenantId, wardId, status: "active", deletedAt: null },
    select: { stage: true },
  })

  let best: WardSalesStage = "none"
  for (const a of apps) {
    if (STAGE_PRIORITY[a.stage] > STAGE_PRIORITY[best]) best = a.stage
  }

  const current = await tx.ward.findUnique({
    where: { id: wardId },
    select: { salesStage: true, clientId: true },
  })
  if (current && current.salesStage !== best) {
    await tx.ward.update({
      where: { id: wardId },
      data: { salesStage: best, salesStageAt: at },
    })

    // Ребёнок вышел из awaiting_payment → закрываем payment_due родителя, если у
    // него не осталось детей в ожидании оплаты (ward уже обновлён выше, поэтому
    // count его не учитывает). completedBy=null — системное закрытие.
    if (current.salesStage === "awaiting_payment" && best !== "awaiting_payment") {
      const stillAwaiting = await tx.ward.count({
        where: { tenantId, clientId: current.clientId, salesStage: "awaiting_payment" },
      })
      if (stillAwaiting === 0) {
        await tx.task.updateMany({
          where: {
            tenantId,
            clientId: current.clientId,
            autoTrigger: "payment_due",
            status: "pending",
            deletedAt: null,
          },
          data: { status: "completed", completedAt: at },
        })
      }
    }
  }

  return best
}
