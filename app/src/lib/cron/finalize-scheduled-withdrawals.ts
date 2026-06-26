import { db } from "@/lib/db"
import { applyWithdrawalSettlement } from "@/lib/subscriptions/finalize-withdrawal"

/**
 * Финализация отложенных отчислений (Подход A).
 *
 * Абонемент с `scheduledWithdrawalDate = X` остаётся active до X: ребёнок ходит,
 * занятия списываются по факту. На X+1 этот cron проводит финальную сверку
 * (`applyWithdrawalSettlement`) — остаток за непосещённые занятия возвращается на
 * баланс, абонемент → withdrawn, клиент при необходимости → «Выбывший».
 *
 * Условие «due»: `scheduledWithdrawalDate < сегодня` (дата X полностью прошла,
 * наступил X+1) и абонемент ещё живой. Каждый абонемент финализируется в
 * отдельной транзакции с перепроверкой под блокировкой (гонка с ручным
 * отчислением/отменой плана). Ошибка по одному не роняет cron.
 *
 * Глобально по всем тенантам (как healAnnulledSubscriptions) — настройки per-tenant
 * тут нет.
 */
export async function finalizeScheduledWithdrawals(now: Date = new Date()) {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  const due = await db.subscription.findMany({
    where: {
      deletedAt: null,
      status: { in: ["active", "pending"] },
      scheduledWithdrawalDate: { not: null, lt: today },
    },
    select: { id: true, tenantId: true },
  })

  let finalized = 0
  for (const s of due) {
    try {
      const done = await db.$transaction(async (tx) => {
        // Перепроверка под блокировкой строки: план мог быть отменён или
        // абонемент уже отчислён вручную между выборкой и транзакцией.
        const fresh = await tx.subscription.findFirst({
          where: {
            id: s.id,
            tenantId: s.tenantId,
            deletedAt: null,
            status: { in: ["active", "pending"] },
            scheduledWithdrawalDate: { not: null, lt: today },
          },
          select: {
            id: true,
            clientId: true,
            directionId: true,
            scheduledWithdrawalDate: true,
            scheduledWithdrawalReasonId: true,
          },
        })
        if (!fresh || !fresh.scheduledWithdrawalDate) return false

        await applyWithdrawalSettlement(tx, {
          tenantId: s.tenantId,
          subscription: {
            id: fresh.id,
            clientId: fresh.clientId,
            directionId: fresh.directionId,
          },
          withdrawalDate: fresh.scheduledWithdrawalDate,
          withdrawalReasonId: fresh.scheduledWithdrawalReasonId,
          createdBy: null,
        })
        return true
      })
      if (done) finalized++
    } catch (e) {
      console.error(`[cron:finalize-withdrawal] subscription ${s.id} failed`, e)
    }
  }

  return { due: due.length, finalized }
}
