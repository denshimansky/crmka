import { Prisma } from "@prisma/client"

type TxClient = Prisma.TransactionClient

export interface LinkedDiscountChange {
  discountId: string
  subscriptionId: string
  directionName: string
  oldAmount: number
  removed: boolean
}

/**
 * SUB-07: Пересчёт связанных скидок при отчислении / деактивации зачисления.
 *
 * «Связанная скидка» (type = linked) действует, когда у клиента >=2 активных
 * абонементов. Если после отчисления осталось <2, все linked-скидки клиента
 * деактивируются и суммы абонементов пересчитываются.
 *
 * Возвращает массив затронутых скидок (для уведомления в API-ответе).
 */
export async function recalcLinkedDiscounts(
  tx: TxClient,
  tenantId: string,
  clientId: string,
  /** ID абонемента, который только что закрыли/отчислили — исключаем из подсчёта */
  excludeSubscriptionId?: string
): Promise<LinkedDiscountChange[]> {
  // 1. Считаем активные абонементы клиента
  const activeCount = await tx.subscription.count({
    where: {
      tenantId,
      clientId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      ...(excludeSubscriptionId ? { id: { not: excludeSubscriptionId } } : {}),
    },
  })

  // Если >=2 активных абонементов, связанная скидка сохраняется
  if (activeCount >= 2) return []

  // 2. Ищем активные linked-скидки клиента
  const linkedDiscounts = await tx.discount.findMany({
    where: {
      tenantId,
      isActive: true,
      type: "linked",
      subscription: { clientId, deletedAt: null },
    },
    include: {
      subscription: {
        select: {
          id: true,
          lessonPrice: true,
          totalLessons: true,
          direction: { select: { name: true } },
        },
      },
    },
  })

  if (linkedDiscounts.length === 0) return []

  const changes: LinkedDiscountChange[] = []

  for (const disc of linkedDiscounts) {
    const sub = disc.subscription

    // Деактивируем скидку
    await tx.discount.update({
      where: { id: disc.id },
      data: { isActive: false },
    })

    // Пересчитываем сумму абонемента без этой скидки
    // Считаем оставшиеся активные скидки
    const remainingDiscounts = await tx.discount.findMany({
      where: {
        subscriptionId: sub.id,
        isActive: true,
        id: { not: disc.id },
      },
    })

    const totalAmount = Number(sub.lessonPrice) * sub.totalLessons
    const newDiscountAmount = remainingDiscounts.reduce(
      (sum, d) => sum + Number(d.calculatedAmount),
      0
    )
    const finalAmount = totalAmount - newDiscountAmount

    // Пересчитываем баланс
    const paidSum = await tx.payment.aggregate({
      where: { subscriptionId: sub.id, deletedAt: null },
      _sum: { amount: true },
    })
    const paid = Number(paidSum._sum.amount || 0)
    const balance = finalAmount - paid

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        discountAmount: newDiscountAmount,
        finalAmount,
        balance,
      },
    })

    changes.push({
      discountId: disc.id,
      subscriptionId: sub.id,
      directionName: sub.direction.name,
      oldAmount: Number(disc.calculatedAmount),
      removed: true,
    })
  }

  return changes
}
