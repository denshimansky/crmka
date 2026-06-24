import type { Prisma, PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface NotRenewedOptions {
  /** «Текущий» месяц (M): продление ищем в нём, исходные абонементы — в M−1. */
  year: number
  month: number
  /** package-режим организации (Organization.subscriptionType === "package"). */
  isPackage: boolean
  /** Ограничить одним клиентом (для карточки клиента). */
  clientId?: string
  /** Ограничить направлением (фильтр отчёта). */
  directionId?: string
}

export interface NotRenewedSubscription {
  id: string
  clientId: string
  directionId: string
  finalAmount: Prisma.Decimal
  periodYear: number | null
  periodMonth: number | null
  expiresAt: Date | null
  client: {
    id: string
    firstName: string | null
    lastName: string | null
    phone: string | null
    branchId: string | null
  }
  direction: { name: string }
  group: { name: string }
}

export interface NotRenewedResult {
  prevYear: number
  prevMonth: number
  /** Все «исходные» абонементы M−1 (status active/closed) — знаменатель renewalRate. */
  lastMonthSubs: NotRenewedSubscription[]
  /** Подмножество lastMonthSubs без продления в M. */
  notRenewed: NotRenewedSubscription[]
}

/**
 * Непродлённые абонементы — единый источник истины для отчёта «Непродлённые»
 * (reports/not-renewed) и карточки клиента (clients/[id]/unprolonged).
 *
 * Определение (подтверждено 24.06.2026): был абонемент в прошлом месяце (M−1)
 * по направлению, а в текущем (M) по тому же (клиент, направление) нового нет.
 *   - calendar: M−1 по periodYear/periodMonth; продление — наличие в M.
 *   - package: исходный пакет истёк в M−1 (expiresAt в окне M−1); продление —
 *     новый пакет, начатый в окне [истечение−7 дней, конец M].
 * «Был абонемент» = status ∈ {active, closed} (реальный, не pending/withdrawn).
 */
export async function findNotRenewedSubscriptions(
  db: DB,
  tenantId: string,
  opts: NotRenewedOptions,
): Promise<NotRenewedResult> {
  const { year, month, isPackage, clientId, directionId } = opts

  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prevDate.getUTCFullYear()
  const prevMonth = prevDate.getUTCMonth() + 1

  const prevStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1))
  const prevEnd = new Date(Date.UTC(prevYear, prevMonth, 0, 23, 59, 59, 999))
  const currentEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const subWhere: Prisma.SubscriptionWhereInput = {
    tenantId,
    deletedAt: null,
    status: { in: ["active", "closed"] },
    ...(isPackage
      ? { type: "package", expiresAt: { gte: prevStart, lte: prevEnd } }
      : { periodYear: prevYear, periodMonth: prevMonth }),
    ...(clientId ? { clientId } : {}),
    ...(directionId ? { directionId } : {}),
  }

  const lastMonthSubs = await db.subscription.findMany({
    where: subWhere,
    select: {
      id: true,
      clientId: true,
      directionId: true,
      finalAmount: true,
      periodYear: true,
      periodMonth: true,
      expiresAt: true,
      client: {
        select: { id: true, firstName: true, lastName: true, phone: true, branchId: true },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  // Текущие абонементы. Для package — пакеты, начатые в окне «истечение −7 дней
  // → конец текущего месяца» (продлевался почти сразу).
  const currentMonthSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(isPackage
        ? {
            type: "package",
            startDate: {
              gte: new Date(prevStart.getTime() - 7 * 24 * 60 * 60 * 1000),
              lte: currentEnd,
            },
          }
        : { periodYear: year, periodMonth: month }),
      ...(clientId ? { clientId } : {}),
    },
    select: { clientId: true, directionId: true },
  })

  const renewedSet = new Set(
    currentMonthSubs.map((s) => `${s.clientId}:${s.directionId}`),
  )

  const notRenewed = lastMonthSubs.filter(
    (s) => !renewedSet.has(`${s.clientId}:${s.directionId}`),
  )

  return { prevYear, prevMonth, lastMonthSubs, notRenewed }
}
