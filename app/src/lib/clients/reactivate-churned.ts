import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Возврат «Выбывшего» клиента в активные при повторной оплате или активации
 * абонемента (Баг #5).
 *
 * PATCH /api/clients/[id] запрещает переводить клиента в churned, пока есть
 * активные абонементы, поэтому churned + активный абонемент — всегда
 * рассинхрон: клиента выбыли, когда его абонементы были pending/отчислены,
 * затем он оплатил — но статус возвращала только ПЕРВАЯ оплата
 * (isFirstPayment), повторная нет.
 *
 * funnelStatus не трогаем: Архив/ЧС имеют приоритет в отображении, а у
 * вернувшегося клиента воронка и так active_client (обратно в лида нельзя).
 */
export async function reactivateChurnedClient(
  t: Tx,
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const res = await t.client.updateMany({
    where: { id: clientId, tenantId, deletedAt: null, clientStatus: "churned" },
    data: { clientStatus: "active", withdrawalDate: null },
  })
  return res.count > 0
}
