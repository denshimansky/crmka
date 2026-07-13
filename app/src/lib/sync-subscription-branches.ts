import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"

// SaaS-подписка тарифицируется по числу филиалов: после создания/удаления
// филиала подтягиваем branchCount подписки к фактическому числу активных
// филиалов и пересчитываем месячную цену по сетке тарифа.
// Организация без филиалов платит как за один.
export async function syncSubscriptionBranchCount(tenantId: string) {
  const actual = await db.branch.count({ where: { tenantId, deletedAt: null } })
  const branchCount = Math.max(1, actual)

  const subscription = await db.billingSubscription.findFirst({
    where: { organizationId: tenantId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })
  if (!subscription || subscription.branchCount === branchCount) return

  await db.billingSubscription.update({
    where: { id: subscription.id },
    data: {
      branchCount,
      monthlyAmount: monthlyPriceFor(subscription.plan, branchCount),
    },
  })
}
