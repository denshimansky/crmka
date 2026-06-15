// Убирание ребёнка из группы при отчислении/аннулировании абонемента.
//
// Правило (критично для календарного типа): каждый месяц — НОВЫЙ Subscription,
// а GroupEnrollment ОДИН на (group, client, ward) и переживает месяцы. Поэтому
// отчисление одного месячного абонемента должно убирать ребёнка из группы
// ТОЛЬКО если у него не осталось другого живого (pending/active) абонемента в
// этой же группе. Иначе ребёнок с оплаченным другим месяцем выпал бы из группы
// и расписания.
//
// Скоуп ребёнка единый: clientId + wardId (wardId=null для взрослого абонемента
// самого клиента — так не задеваются зачисления его детей). Этим же helper'ом
// чинится прежнее расхождение фильтров между PATCH, /refund и cron.
//
// Используется из:
//   - PATCH /api/subscriptions/[id]            (ручное «Отчислить»)
//   - POST  /api/subscriptions/[id]/refund     (отчисление с возвратом)
//   - cron close-unpaid-subscriptions          (автозакрытие неоплаченных)

import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

export interface DeactivateEnrollmentInput {
  tenantId: string
  groupId: string
  clientId: string
  /** Подопечный; null — взрослый абонемент самого клиента. */
  wardId: string | null
  /** Текущий абонемент — исключается из проверки «есть ли другие живые». */
  excludeSubscriptionId: string
  /** Дата отчисления из группы (по умолчанию — сейчас). */
  withdrawnAt?: Date
}

/**
 * Деактивирует зачисление (isActive=false, withdrawnAt), но только если у
 * ребёнка не осталось другого живого (pending/active) абонемента в этой группе.
 * Возвращает число деактивированных зачислений (0 — ребёнок оставлен в группе,
 * т.к. есть другой живой абонемент).
 */
export async function deactivateGroupEnrollmentOnWithdrawal(
  tx: Tx,
  input: DeactivateEnrollmentInput,
): Promise<number> {
  // wardId как string|null Prisma трактует как равенство (в т.ч. IS NULL),
  // поэтому единый скоуп работает и для подопечного, и для взрослого клиента.
  const childScope = { clientId: input.clientId, wardId: input.wardId }

  const otherLive = await tx.subscription.count({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      status: { in: ["pending", "active"] },
      deletedAt: null,
      id: { not: input.excludeSubscriptionId },
      ...childScope,
    },
  })
  if (otherLive > 0) return 0

  const res = await tx.groupEnrollment.updateMany({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      isActive: true,
      deletedAt: null,
      ...childScope,
    },
    data: { isActive: false, withdrawnAt: input.withdrawnAt ?? new Date() },
  })
  return res.count
}
