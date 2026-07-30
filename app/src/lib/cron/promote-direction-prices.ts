import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { toUtcDay } from "@/lib/subscriptions/direction-price"
import { planPromotions } from "@/lib/cron/promote-direction-prices-plan"

/**
 * Промоутер цен направлений (баг #88).
 *
 * Ежедневно в 00:00 UTC (= 03:00 МСК, см. /api/cron/promote-direction-prices)
 * переносит наступившие версии `DirectionPrice` (effectiveFrom <= сегодня, не
 * применена, не удалена) в базовые поля их направления и помечает версии
 * `appliedAt`. Благодаря этому все существующие потребители цены направления
 * (разовое, пробное, отчёты, ЗП, скидки, формы) автоматически берут новую цену с
 * даты вступления — без изменений в их коде. Точки создания абонемента используют
 * резолвер и подхватывают будущую цену ещё до промоутинга (выписка вперёд).
 *
 * Идемпотентно: applied-версии повторно не берутся. Если крон не запускался
 * несколько дней и накопилось несколько due-версий на направление — в базу
 * попадает самая поздняя, промежуточные тоже помечаются applied.
 *
 * Лог: console.info по каждому направлению для server-side audit (как в остальных
 * cron-воркерах).
 */
export async function promoteDirectionPrices(now: Date = new Date()) {
  const todayUtc = toUtcDay(now)
  const due = await db.directionPrice.findMany({
    where: {
      appliedAt: null,
      deletedAt: null,
      effectiveFrom: { lte: todayUtc },
    },
    select: {
      id: true,
      tenantId: true,
      directionId: true,
      effectiveFrom: true,
      lessonPrice: true,
      trialPrice: true,
      trialFree: true,
      singleVisitPrice: true,
      packagePrices: true,
      appliedAt: true,
      deletedAt: true,
    },
  })

  if (due.length === 0) return { promoted: 0, versionsApplied: 0 }

  const tenantByDir = new Map<string, string>()
  for (const v of due) tenantByDir.set(v.directionId, v.tenantId)

  const plans = planPromotions(due, now)
  const appliedAt = new Date()
  let promoted = 0
  let versionsApplied = 0

  for (const plan of plans) {
    const w = plan.winner
    await db.$transaction(async (tx) => {
      await tx.direction.update({
        where: { id: plan.directionId },
        data: {
          lessonPrice: w.lessonPrice,
          trialPrice: w.trialPrice,
          trialFree: w.trialFree,
          singleVisitPrice: w.singleVisitPrice,
          // JSON-поле: null передаём как Prisma.JsonNull (не raw null).
          packagePrices:
            w.packagePrices == null
              ? Prisma.JsonNull
              : (w.packagePrices as Prisma.InputJsonValue),
        },
      })
      await tx.directionPrice.updateMany({
        where: { id: { in: plan.appliedIds } },
        data: { appliedAt },
      })
    })
    promoted++
    versionsApplied += plan.appliedIds.length
    console.info(`[cron:promote-direction-prices] promoted direction ${plan.directionId}`, {
      tenantId: tenantByDir.get(plan.directionId),
      effectiveFrom: w.effectiveFrom.toISOString().slice(0, 10),
      lessonPrice: String(w.lessonPrice),
      versionsApplied: plan.appliedIds.length,
    })
  }

  return { promoted, versionsApplied }
}
