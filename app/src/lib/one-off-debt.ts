import { db } from "@/lib/db"

// Долг за разовые посещения = часть минусового clientBalance, объяснимая
// ledger-типом personal_lesson_charge за вычетом возвратов разовых.
// Возвраты разовых — положительные attendance_revert без абонемента;
// абонементные откаты (lesson_refund) — всегда отрицательные, поэтому знак
// надёжно разделяет семантики. Остаток минуса — перенесённый/импортный долг.
export async function oneOffDebtByClient(
  tenantId: string,
  clients: { id: string; clientBalance: unknown }[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const neg = clients.filter((c) => Number(c.clientBalance) < 0)
  if (neg.length === 0) return result

  const ids = neg.map((c) => c.id)
  const [charges, reverts] = await Promise.all([
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      where: { tenantId, clientId: { in: ids }, type: "personal_lesson_charge" },
      _sum: { amount: true },
    }),
    db.clientBalanceTransaction.groupBy({
      by: ["clientId"],
      where: {
        tenantId,
        clientId: { in: ids },
        type: "attendance_revert",
        subscriptionId: null,
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
  ])

  const net = new Map<string, number>()
  for (const g of charges) net.set(g.clientId, -Number(g._sum.amount || 0))
  for (const g of reverts) {
    net.set(g.clientId, (net.get(g.clientId) || 0) - Number(g._sum.amount || 0))
  }

  for (const c of neg) {
    const oneOff = Math.min(-Number(c.clientBalance), Math.max(0, net.get(c.id) || 0))
    if (oneOff > 0) result.set(c.id, oneOff)
  }
  return result
}
