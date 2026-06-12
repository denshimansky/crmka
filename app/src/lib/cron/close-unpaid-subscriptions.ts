import { db } from "@/lib/db"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"

/**
 * Авто-закрытие неоплаченных абонементов.
 *
 * Условия закрытия (для каждого тенанта с настройкой Organization.unpaidSubscriptionAutoCloseDays):
 *   1. Subscription.balance > 0 (есть долг — не оплачен полностью).
 *   2. Subscription.status IN ('pending', 'active').
 *   3. У абонемента нет ни одной записи Attendance (ребёнок не приходил).
 *   4. С даты startDate прошло >= N дней.
 *
 * Действия:
 *   — Subscription: status='closed', endDate=today.
 *   — Связанные GroupEnrollment: isActive=false, withdrawnAt=today.
 *   — Если у клиента не осталось активных абонементов И были платежи в истории —
 *     перевод clientStatus в 'churned' с withdrawalDate=today.
 *
 * Возвращает количество затронутых абонементов и клиентов, ушедших в churned.
 */
export async function closeUnpaidSubscriptions(now: Date = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const tenants = await db.organization.findMany({
    where: { unpaidSubscriptionAutoCloseDays: { not: null, gt: 0 } },
    select: { id: true, unpaidSubscriptionAutoCloseDays: true },
  })

  let closedSubs = 0
  let churnedClients = 0

  for (const t of tenants) {
    const days = t.unpaidSubscriptionAutoCloseDays!
    const threshold = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)

    const candidates = await db.subscription.findMany({
      where: {
        tenantId: t.id,
        deletedAt: null,
        status: { in: ["pending", "active"] },
        balance: { gt: 0 },
        startDate: { lte: threshold },
      },
      select: {
        id: true,
        clientId: true,
        wardId: true,
        groupId: true,
        _count: { select: { attendances: true } },
      },
    })

    const toClose = candidates.filter((s) => s._count.attendances === 0)
    if (toClose.length === 0) continue

    const subIds = toClose.map((s) => s.id)
    const affectedClientIds = Array.from(new Set(toClose.map((s) => s.clientId)))

    await db.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { id: { in: subIds } },
        data: { status: "closed", endDate: today },
      })

      // Закрываем зачисления, привязанные к закрытым абонементам.
      for (const s of toClose) {
        await tx.groupEnrollment.updateMany({
          where: {
            tenantId: t.id,
            groupId: s.groupId,
            clientId: s.clientId,
            wardId: s.wardId ?? undefined,
            isActive: true,
            deletedAt: null,
          },
          data: { isActive: false, withdrawnAt: today },
        })
      }
    })

    closedSubs += toClose.length

    // Пересчёт clientStatus + шаблонных скидок для каждого затронутого клиента.
    for (const clientId of affectedClientIds) {
      const [activeSubsLeft, paymentsCount] = await Promise.all([
        db.subscription.count({
          where: { tenantId: t.id, clientId, status: "active", deletedAt: null },
        }),
        db.payment.count({ where: { tenantId: t.id, clientId } }),
      ])
      if (activeSubsLeft === 0 && paymentsCount > 0) {
        const res = await db.client.updateMany({
          where: {
            id: clientId,
            tenantId: t.id,
            clientStatus: "active",
          },
          data: { clientStatus: "churned", withdrawalDate: today },
        })
        churnedClients += res.count
      }
      // Скидки v2: закрытый без отметок аннулирован и выпадает из состава
      // месяца — пересчитываем скидки оставшихся абонементов клиента.
      await db.$transaction(async (tx) => {
        await recalcClientDiscounts(tx, {
          tenantId: t.id,
          clientId,
          createdBy: null,
        })
      })
    }
  }

  return { closedSubs, churnedClients }
}
