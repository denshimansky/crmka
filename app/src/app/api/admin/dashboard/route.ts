import { NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"

// GET /api/admin/dashboard — управленческая статистика
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const prevMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // Все организации
  const allOrgs = await db.organization.findMany({
    select: {
      id: true,
      name: true,
      billingStatus: true,
      onboardingCompleted: true,
      createdAt: true,
      _count: {
        select: {
          clients: { where: { deletedAt: null } },
          employees: { where: { deletedAt: null } },
          branches: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // Подсчёт по статусам
  const statusCounts = {
    total: allOrgs.length,
    active: allOrgs.filter((o) => o.billingStatus === "active").length,
    grace: allOrgs.filter((o) => o.billingStatus === "grace_period").length,
    blocked: allOrgs.filter((o) => o.billingStatus === "blocked").length,
  }

  // Новые за этот месяц
  const newThisMonth = allOrgs.filter((o) => new Date(o.createdAt) >= monthStart).length
  // Новые за прошлый месяц (для сравнения)
  const newLastMonth = allOrgs.filter(
    (o) => new Date(o.createdAt) >= prevMonthStart && new Date(o.createdAt) < monthStart
  ).length

  // Топ-10 по клиентам
  const topByClients = [...allOrgs]
    .sort((a, b) => b._count.clients - a._count.clients)
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      name: o.name,
      clients: o._count.clients,
      employees: o._count.employees,
      branches: o._count.branches,
      status: o.billingStatus,
    }))

  // «Спящие» — последний AuditLog > 7 дней назад или нет записей
  const recentActivity = await db.auditLog.groupBy({
    by: ["tenantId"],
    where: {
      createdAt: { gte: sevenDaysAgo },
      tenantId: { not: null },
    },
    _max: { createdAt: true },
  })
  const activeOrgIds = new Set(recentActivity.map((a) => a.tenantId).filter(Boolean))
  const sleeping = allOrgs
    .filter((o) => o.billingStatus === "active" && !activeOrgIds.has(o.id))
    .map((o) => ({
      id: o.id,
      name: o.name,
      clients: o._count.clients,
    }))

  // Не завершили онбординг
  const notOnboarded = allOrgs
    .filter((o) => !o.onboardingCompleted)
    .map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
    }))

  // MRR (сумма активных подписок)
  const activeSubs = await db.billingSubscription.aggregate({
    where: { status: "active" },
    _sum: { monthlyAmount: true },
    _count: true,
  })

  // Неоплаченные счета
  const unpaidInvoices = await db.billingInvoice.aggregate({
    where: { status: { in: ["pending", "overdue"] } },
    _sum: { amount: true },
    _count: true,
  })

  const overdueInvoices = await db.billingInvoice.count({
    where: { status: "overdue" },
  })

  return NextResponse.json({
    statusCounts,
    newThisMonth,
    newLastMonth,
    topByClients,
    sleeping,
    notOnboarded,
    mrr: Number(activeSubs._sum.monthlyAmount || 0),
    activeSubsCount: activeSubs._count,
    unpaidAmount: Number(unpaidInvoices._sum.amount || 0),
    unpaidCount: unpaidInvoices._count,
    overdueCount: overdueInvoices,
  })
}
