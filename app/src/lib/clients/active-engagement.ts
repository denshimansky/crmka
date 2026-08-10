import { Prisma, type PrismaClient } from "@prisma/client"

type Db = Prisma.TransactionClient | PrismaClient

// Окно «текущей платной активности» в днях. Совпадает с порогом крона оттока
// (check-inactive-clients): клиент считается активным, пока у него есть активный
// абонемент ИЛИ платное занятие не старше этого окна.
export const ACTIVE_ENGAGEMENT_WINDOW_DAYS = 30

/**
 * «Текущая платная активность» клиента = у него есть активный абонемент ИЛИ
 * платное занятие (chargeAmount > 0) за последние ACTIVE_ENGAGEMENT_WINDOW_DAYS
 * дней. Это ровно те события, что делают лида клиентом (оплата абонемента /
 * платное занятие, см. pay-from-balance.ts и attendance/route.ts), поэтому один
 * предикат используется и гардом ручного возврата в «Активные»
 * (PATCH /api/clients/[id]), и кроном оттока.
 *
 * Простое пополнение баланса активностью НЕ считается (как и при конверсии).
 */
export async function hasActiveEngagement(
  db: Db,
  tenantId: string,
  clientId: string,
  asOf: Date = new Date(),
): Promise<boolean> {
  const activeSub = await db.subscription.count({
    where: { tenantId, clientId, status: "active", deletedAt: null },
  })
  if (activeSub > 0) return true

  const since = new Date(asOf)
  since.setDate(since.getDate() - ACTIVE_ENGAGEMENT_WINDOW_DAYS)
  const paidLesson = await db.attendance.findFirst({
    where: {
      tenantId,
      clientId,
      chargeAmount: { gt: 0 },
      lesson: { date: { gte: since } },
    },
    select: { id: true },
  })
  return paidLesson !== null
}

/**
 * Самая поздняя из дат (или null, если все пусты). Используется кроном оттока,
 * чтобы взять последнее платное событие клиента среди дат абонементов и даты
 * последнего платного занятия. Чистая функция — покрыта юнит-тестом.
 */
export function latestDate(dates: Array<Date | null | undefined>): Date | null {
  const ts = dates
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime())
  return ts.length > 0 ? new Date(Math.max(...ts)) : null
}
