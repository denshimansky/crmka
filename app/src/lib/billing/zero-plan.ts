import { db } from "@/lib/db"
import type { BillingPlan } from "@prisma/client"

// «Нулевой» тариф — служебный план 0 ₽ для внутренних и тестовых организаций.
// Наши и демонстрационные базы, переведённые на него, не попадают в MRR и
// прогнозы выручки бэк-офиса (monthlyAmount считается по плану и равен 0 при
// любом числе филиалов).
//
// Важно: «обнуление» делается именно сменой ПЛАНА, а не записью monthlyAmount=0
// на платный план — иначе syncSubscriptionBranchCount при добавлении/удалении
// филиала пересчитает сумму обратно по сетке платного тарифа.
//
// План опознаётся по каноническому имени и заводится один раз (лениво, при
// первом обнулении), поэтому на существующих базах отдельная миграция не нужна.
export const ZERO_PLAN_NAME = "Нулевой (внутренний)"

export async function findOrCreateZeroPlan(): Promise<BillingPlan> {
  const existing = await db.billingPlan.findFirst({ where: { name: ZERO_PLAN_NAME } })
  if (existing) return existing
  return db.billingPlan.create({
    data: {
      name: ZERO_PLAN_NAME,
      pricePerBranch: 0,
      priceTiers: undefined,
      description: "Служебный тариф 0 ₽ для внутренних и тестовых баз — не учитывается в MRR и прогнозах",
      isActive: true,
    },
  })
}
