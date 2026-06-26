import { type Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Отчисление абонемента → клиент «Выбывший», если у него не осталось ни одного
 * активного абонемента.
 *
 * Обратная сторона reactivateChurnedClient (Баг #5). Документированный
 * инвариант вкладки «Активные» (crm/contacts/page.tsx): clientStatus меняется
 * на churned «при отчислении». Раньше оба пути отчисления (PATCH subscriptions
 * и /refund) деактивировали зачисление и пересчитывали баланс, но clientStatus
 * оставался 'active' — клиент навсегда зависал во вкладке «Активные» без живого
 * абонемента (cron check-inactive-clients подбирал его лишь через 30 дней после
 * конца периода последнего абонемента).
 *
 * «Активный» = status='active' — то же определение, что в ручном PATCH клиента
 * (clients/[id]), cron close-unpaid и check-inactive. pending намеренно не
 * считается живым: повторная оплата/активация вернёт клиента
 * (reactivateChurnedClient). funnelStatus не трогаем (Архив/ЧС приоритетнее в
 * отображении, обратно в лида нельзя). Только clientStatus='active' переводим в
 * churned — архив/ЧС/уже-выбывших не задеваем.
 *
 * Вызывать ПОСЛЕ перевода текущего абонемента в withdrawn — иначе он сам
 * попадёт в счётчик активных и клиент не выбудет.
 */
export async function churnClientIfNoActiveSubscription(
  t: Tx,
  tenantId: string,
  clientId: string,
  withdrawalDate: Date,
): Promise<boolean> {
  const activeLeft = await t.subscription.count({
    where: { tenantId, clientId, status: "active", deletedAt: null },
  })
  if (activeLeft > 0) return false
  const res = await t.client.updateMany({
    where: { id: clientId, tenantId, deletedAt: null, clientStatus: "active" },
    data: { clientStatus: "churned", withdrawalDate },
  })
  return res.count > 0
}
