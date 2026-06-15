// Побочные эффекты активации абонемента (pending → active): заявка воронки
// «Ожидаем оплату» выигрывается, пересчитывается зеркало Ward.salesStage,
// зачисление в группу переводится в paymentStatus=active.
//
// Используется из pay-from-balance (полная оплата) и из пересчёта скидок
// (Скидки v2: абонемент со 100% скидкой или «доплаченный» возвратом активируется
// автоматически — оплачивать нечего).

import { Prisma, type PrismaClient } from "@prisma/client"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { reactivateChurnedClient } from "@/lib/clients/reactivate-churned"

type Tx = Prisma.TransactionClient | PrismaClient

export interface ActivateSubscriptionInput {
  tenantId: string
  subscription: {
    id: string
    clientId: string
    wardId: string | null
    groupId: string
    directionId: string
  }
  createdBy?: string | null
}

/** Помечает абонемент активным и выполняет побочные эффекты выигрыша заявки. */
export async function activateSubscription(
  t: Tx,
  input: ActivateSubscriptionInput,
): Promise<void> {
  const { tenantId, subscription: sub, createdBy } = input

  await t.subscription.update({
    where: { id: sub.id },
    data: { status: "active", activatedAt: new Date() },
  })

  // Активация абонемента «Выбывшего» — клиент вернулся (Баг #5).
  await reactivateChurnedClient(t, tenantId, sub.clientId)

  // Зачисление в группу → «оплачено». Делаем ДО раннего выхода по wardId:
  // взрослый абонемент (wardId=null) тоже имеет зачисление и должен сняться
  // с флажка «Ожидаем оплату» после оплаты.
  await t.groupEnrollment.updateMany({
    where: {
      tenantId,
      groupId: sub.groupId,
      clientId: sub.clientId,
      wardId: sub.wardId,
      isActive: true,
    },
    data: { paymentStatus: "active" },
  })

  if (!sub.wardId) return

  // Заявка, по которой выписан этот абонемент, выиграна (оплачена) — уходит из
  // воронки (won). Остальные заявки ребёнка остаются. Матчим по направлению, а
  // если не нашли и у ребёнка ровно одна заявка в «Ожидаем оплату» — берём её.
  const wonData = {
    status: "processed" as const,
    processedToStatus: "won" as const,
    processedAt: new Date(),
    processedBy: createdBy ?? undefined,
  }
  const wonByDirection = await t.application.updateMany({
    where: {
      tenantId,
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
        tenantId,
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
  await recomputeWardSalesStage(t, tenantId, sub.wardId)
}
