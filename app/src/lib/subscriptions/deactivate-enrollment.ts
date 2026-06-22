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
import { nextDayUtc } from "./last-paid-lesson-date"

type Tx = Prisma.TransactionClient | PrismaClient

export interface DeactivateEnrollmentInput {
  tenantId: string
  groupId: string
  clientId: string
  /** Подопечный; null — взрослый абонемент самого клиента. */
  wardId: string | null
  /** Текущий абонемент — исключается из проверки «есть ли другие живые». */
  excludeSubscriptionId: string
  /**
   * @deprecated Не используется. Граница состава вычисляется ВНУТРИ по
   * последнему платному занятию ребёнка в группе (+1), а не по дате отчисления
   * абонемента. Поле оставлено для совместимости вызовов.
   */
  withdrawnAt?: Date
}

/**
 * Деактивирует зачисление (isActive=false, withdrawnAt), но только если у
 * ребёнка не осталось другого живого (pending/active) абонемента в этой группе.
 * Возвращает число деактивированных зачислений (0 — ребёнок оставлен в группе,
 * т.к. есть другой живой абонемент).
 *
 * Граница состава (withdrawnAt) = последнее ПЛАТНОЕ занятие ребёнка в этой группе
 * + 1 день (charge_amount > 0, по всем его абонементам группы; фильтр состава —
 * withdrawnAt > дата занятия, поэтому на последнем платном занятии ребёнок виден,
 * в более поздних — нет). Если платных занятий не было — withdrawnAt = enrolledAt:
 * ребёнок так и не начал платно заниматься и не должен висеть НИ В ОДНОМ занятии
 * (в т.ч. в «Неотмеченных»). Это и есть правило «исчезает с даты последнего
 * платного занятия, а не с даты отчисления абонемента» (баг #40). Дата отчисления
 * абонемента (Subscription.withdrawalDate) — отдельная учётная величина и сюда
 * НЕ влияет.
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

  const enrollments = await tx.groupEnrollment.findMany({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      isActive: true,
      deletedAt: null,
      ...childScope,
    },
    select: { id: true, enrolledAt: true },
  })
  if (enrollments.length === 0) return 0

  // Последнее платное занятие ребёнка именно в ЭТОЙ группе (по всем абонементам).
  const lastPaid = await tx.attendance.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      wardId: input.wardId,
      chargeAmount: { gt: 0 },
      lesson: { groupId: input.groupId },
    },
    orderBy: { lesson: { date: "desc" } },
    select: { lesson: { select: { date: true } } },
  })
  const boundary = lastPaid ? nextDayUtc(lastPaid.lesson.date) : null

  let count = 0
  for (const e of enrollments) {
    await tx.groupEnrollment.update({
      where: { id: e.id },
      // Нет платных занятий → withdrawnAt = enrolledAt (ребёнок невидим везде).
      data: { isActive: false, withdrawnAt: boundary ?? e.enrolledAt },
    })
    count++
  }
  return count
}
