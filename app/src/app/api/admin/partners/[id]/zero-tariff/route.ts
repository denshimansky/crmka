import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { findOrCreateZeroPlan } from "@/lib/billing/zero-plan"
import { toUtcDate } from "@/lib/billing/billing-schedule"

// POST /api/admin/partners/[id]/zero-tariff — принудительно перевести партнёра
// на нулевой тариф (0 ₽). Для внутренних/тестовых баз: убирает организацию из
// MRR и прогнозов выручки (monthlyAmount = 0) и отключает автосчета
// (billingExempt), чтобы служебная база не портила отчётность бэк-офиса.
//
// Обнуление выполняется сменой ПЛАНА на нулевой (а не записью monthlyAmount=0
// на платный план): иначе syncSubscriptionBranchCount при изменении числа
// филиалов пересчитает сумму обратно по платной сетке.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const org = await db.organization.findUnique({ where: { id }, select: { id: true } })
  if (!org) return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 })

  const zeroPlan = await findOrCreateZeroPlan()

  // Последняя не отменённая подписка — переводим её; если подписки нет вовсе,
  // заводим служебную (активную, без теста), чтобы у партнёра был явный 0-тариф.
  const sub = await db.billingSubscription.findFirst({
    where: { organizationId: id, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
  })

  if (sub) {
    await db.billingSubscription.update({
      where: { id: sub.id },
      data: { planId: zeroPlan.id, monthlyAmount: 0 },
    })
  } else {
    const start = toUtcDate(new Date())
    await db.billingSubscription.create({
      data: {
        organizationId: id,
        planId: zeroPlan.id,
        branchCount: 1,
        monthlyAmount: 0,
        status: "active",
        startDate: start,
        nextPaymentDate: start,
      },
    })
  }

  // Служебная база: отключаем автосчета 20-го и автоблокировку 1-го, снимаем
  // возможную блокировку.
  await db.organization.update({
    where: { id },
    data: { billingExempt: true, billingStatus: "active" },
  })

  return NextResponse.json({ ok: true, planId: zeroPlan.id })
}
