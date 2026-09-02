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

  // Все ДЕЙСТВУЮЩИЕ организации (+ признак нулевого тарифа и последняя подписка —
  // для разбивки по состояниям). Архивные партнёры (прекратили работу) исключены
  // из всех метрик бэк-офиса — считаем их отдельно (archivedCount).
  const allOrgs = await db.organization.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      billingStatus: true,
      billingExempt: true,
      onboardingCompleted: true,
      createdAt: true,
      billingSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, monthlyAmount: true },
      },
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

  // Подсчёт по статусам биллинга (billingStatus организации)
  const statusCounts = {
    total: allOrgs.length,
    active: allOrgs.filter((o) => o.billingStatus === "active").length,
    grace: allOrgs.filter((o) => o.billingStatus === "grace_period").length,
    blocked: allOrgs.filter((o) => o.billingStatus === "blocked").length,
  }

  // Разбивка партнёров по ВЗАИМОИСКЛЮЧАЮЩИМ состояниям на сегодня — сумма всех
  // бакетов равна total. Приоритет сверху вниз: заблокирован → грейс → нулевой
  // тариф (служебные billingExempt) → триал → платящий. «Нулевой тариф»
  // перекрывает статус подписки: служебная/бесплатная база остаётся нулевой,
  // даже если её подписка формально ещё на триале.
  function classifyPartner(o: (typeof allOrgs)[number]) {
    if (o.billingStatus === "blocked") return "blocked" as const
    if (o.billingStatus === "grace_period") return "grace" as const
    if (o.billingExempt) return "zero" as const
    const sub = o.billingSubscriptions[0]
    if (!sub) return "other" as const
    if (sub.status === "trial") return "trial" as const
    if (sub.status === "blocked") return "blocked" as const
    if (sub.status === "grace_period") return "grace" as const
    if (sub.status === "active") return Number(sub.monthlyAmount) > 0 ? ("paying" as const) : ("zero" as const)
    return "other" as const // отменённая/без активной подписки
  }
  const partnerStates = { paying: 0, trial: 0, zero: 0, blocked: 0, grace: 0, other: 0 }
  for (const o of allOrgs) partnerStates[classifyPartner(o)]++

  // Новые партнёры за месяц — метрика с привязкой к периоду: считаем ВСЕХ
  // созданных в месяце, включая позже архивированных. Факт привлечения —
  // историчен и не должен «переписываться» задним числом при архивировании
  // (в отличие от allOrgs, где архивные исключены для метрик текущего состояния).
  const newThisMonth = await db.organization.count({ where: { createdAt: { gte: monthStart } } })
  const newLastMonth = await db.organization.count({
    where: { createdAt: { gte: prevMonthStart, lt: monthStart } },
  })

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

  // MRR (сумма активных подписок) — без архивных партнёров
  const activeSubs = await db.billingSubscription.aggregate({
    where: { status: "active", organization: { archivedAt: null } },
    _sum: { monthlyAmount: true },
    _count: true,
  })

  // Неоплаченные счета — без архивных (их долги мы не преследуем)
  const unpaidInvoices = await db.billingInvoice.aggregate({
    where: { status: { in: ["pending", "overdue"] }, organization: { archivedAt: null } },
    _sum: { amount: true },
    _count: true,
  })

  const overdueInvoices = await db.billingInvoice.count({
    where: { status: "overdue", organization: { archivedAt: null } },
  })

  // Архивные партнёры (прекратили работу) — для справки в шапке бэк-офиса
  const archivedCount = await db.organization.count({
    where: { archivedAt: { not: null } },
  })

  // Что именно осталось «за кадром» из-за архива — чтобы цифры карточек нельзя
  // было принять за недосчёт: показываем рядом отдельной строкой.
  const archivedUnpaid = await db.billingInvoice.aggregate({
    where: {
      status: { in: ["pending", "overdue"] },
      organization: { archivedAt: { not: null } },
    },
    _sum: { amount: true },
    _count: true,
  })
  const archivedBlockedCount = await db.organization.count({
    where: { archivedAt: { not: null }, billingStatus: "blocked" },
  })

  return NextResponse.json({
    statusCounts,
    partnerStates,
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
    archivedCount,
    archivedUnpaidCount: archivedUnpaid._count,
    archivedUnpaidAmount: Number(archivedUnpaid._sum.amount || 0),
    archivedBlockedCount,
  })
}
