import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"
import { scopeSubscription } from "@/lib/branch-scope"
import { computeMonthSubscriptionFigures } from "@/lib/finance/subscription-month-figures"

/** 5.3. Ожидаемые поступления */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams, scope } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // ADM-04: филиальный scope (scope ∩ branchId). Применяется и к helper'у, и к
  // прогнозу на следующий месяц ниже, чтобы филиальный админ не видел всю орг.
  const branchAnd: Prisma.SubscriptionWhereInput[] = []
  if (scope) branchAnd.push(scopeSubscription(scope))
  if (branchId) branchAnd.push({ group: { branchId } })

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackage = org?.subscriptionType === "package"

  // Единый набор абонементов месяца (спека Ани 09.08.2026, см.
  // lib/finance/subscription-month-figures.ts): ВСЕ статусы и клиенты, включая
  // воронку; закрытые/выбывшие — по факту отработанного. «Сумма абонементов»
  // здесь совпадает с карточками дашборда «Ожидаемые/Отработанные/Прогноз».
  const figures = await computeMonthSubscriptionFigures(db, {
    tenantId,
    year,
    month,
    scope,
    branchId,
    isPackageOrg: isPackage,
  })

  const totalSubAmount = figures.reduce((s, f) => s + f.subAmount, 0)
  // Ожидается (долг) = остаток к оплате по действующим/ожидающим + долг закрытия
  // по закрытым/выбывшим.
  const expected = figures.reduce((s, f) => s + f.expected, 0)
  const totalPaid = totalSubAmount - expected
  const totalDiscount = figures.reduce((s, f) => s + f.discount, 0)

  // По направлениям
  const byDirection: Record<string, { subAmount: number; expected: number; paid: number }> = {}
  for (const f of figures) {
    const dir = f.directionName
    if (!byDirection[dir]) byDirection[dir] = { subAmount: 0, expected: 0, paid: 0 }
    byDirection[dir].subAmount += f.subAmount
    byDirection[dir].expected += f.expected
  }
  for (const v of Object.values(byDirection)) v.paid = v.subAmount - v.expected

  // Прогноз на следующий месяц — активная база (forward-looking, отдельный расчёт).
  // Для calendar — абонементы периода M+1; для package — пакеты, чей остаток ещё
  // отрабатывается в следующем месяце (expiresAt в нём).
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const nextStart = new Date(Date.UTC(nextYear, nextMonth - 1, 1))
  const nextEnd = new Date(Date.UTC(nextYear, nextMonth, 0, 23, 59, 59, 999))

  const nextMonthForecast = await db.subscription.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ["active", "pending"] },
      client: { clientStatus: "active" },
      ...(branchAnd.length > 0 ? { AND: branchAnd } : {}),
      ...(isPackage
        ? {
            type: "package",
            startDate: { lte: nextEnd },
            OR: [{ expiresAt: null }, { expiresAt: { gte: nextStart } }],
          }
        : { periodYear: nextYear, periodMonth: nextMonth }),
    },
    _sum: { finalAmount: true },
    _count: true,
  })

  return NextResponse.json({
    data: Object.entries(byDirection)
      .map(([direction, v]) => ({
        direction,
        ...v,
        debtPercent: pct(v.expected, v.subAmount),
      }))
      .sort((a, b) => b.expected - a.expected),
    metadata: {
      totalSubAmount,
      expectedIncome: expected,
      totalPaid,
      debtPercent: pct(expected, totalSubAmount),
      totalDiscount,
      nextMonthForecast: Number(nextMonthForecast._sum.finalAmount || 0),
      nextMonthSubCount: nextMonthForecast._count,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
