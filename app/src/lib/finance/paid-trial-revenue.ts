import type { Prisma, PrismaClient } from "@prisma/client"
import { scopeLesson, type BranchScope } from "@/lib/branch-scope"

/**
 * Реализованная выручка платных пробных за месяц (Attendance с isTrial=true и
 * chargeAmount>0, тип «Был» с countsAsRevenue). Нужна там, где база выручки
 * строится по Subscription.chargedAmount (прогноз прибыли) — абонементный
 * источник пробные не видит, а в ОПИУ они входят. Сводим (спека B1).
 */
export async function sumPaidTrialRevenue(
  db: PrismaClient | Prisma.TransactionClient,
  opts: {
    tenantId: string
    year: number
    month: number
    /** Филиальный scope сессии (ADM-04). Не передан — без ограничения. */
    scope?: BranchScope
    /** Ограничить одним филиалом (?branchId= отчёта). */
    branchId?: string | null
  },
): Promise<number> {
  const { tenantId, year, month } = opts
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const lessonAnd: Prisma.LessonWhereInput[] = [{ date: { gte: monthStart, lte: monthEnd } }]
  if (opts.scope) lessonAnd.push(scopeLesson(opts.scope)) // {} если scope не ограничен
  if (opts.branchId) lessonAnd.push({ group: { branchId: opts.branchId } })

  const agg = await db.attendance.aggregate({
    where: {
      tenantId,
      isTrial: true,
      chargeAmount: { gt: 0 },
      attendanceType: { countsAsRevenue: true },
      lesson: { AND: lessonAnd },
    },
    _sum: { chargeAmount: true },
  })
  return Number(agg._sum.chargeAmount ?? 0)
}
