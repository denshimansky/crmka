import { NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"

// GET /api/admin/analytics — статистика использования CRM
export async function GET(req: Request) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = Math.min(Number(searchParams.get("days")) || 30, 90)

  const since = new Date()
  since.setDate(since.getDate() - days)

  // Топ страниц (по количеству просмотров)
  const topPages = await db.pageView.groupBy({
    by: ["path"],
    where: { createdAt: { gte: since }, duration: null },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 30,
  })

  // Среднее время на страницах
  const avgDuration = await db.pageView.groupBy({
    by: ["path"],
    where: { createdAt: { gte: since }, duration: { not: null, gt: 0 } },
    _avg: { duration: true },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 30,
  })

  // Активность по организациям
  const orgActivity = await db.pageView.groupBy({
    by: ["tenantId"],
    where: { createdAt: { gte: since }, tenantId: { not: null }, duration: null },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 20,
  })

  // Подтягиваем имена организаций
  const orgIds = orgActivity
    .map((o) => o.tenantId)
    .filter((id): id is string => id !== null)
  const orgs = orgIds.length
    ? await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      })
    : []
  const orgMap = Object.fromEntries(orgs.map((o) => [o.id, o.name]))

  // Просмотры по дням (тренд)
  const dailyViews: { date: string; count: number }[] = await db.$queryRaw`
    SELECT DATE(created_at) as date, COUNT(*)::int as count
    FROM page_views
    WHERE created_at >= ${since} AND duration IS NULL
    GROUP BY DATE(created_at)
    ORDER BY date
  `

  // Уникальные пользователи по дням
  const dailyUsers: { date: string; count: number }[] = await db.$queryRaw`
    SELECT DATE(created_at) as date, COUNT(DISTINCT employee_id)::int as count
    FROM page_views
    WHERE created_at >= ${since} AND employee_id IS NOT NULL AND duration IS NULL
    GROUP BY DATE(created_at)
    ORDER BY date
  `

  // Общие метрики
  const totalViews = await db.pageView.count({
    where: { createdAt: { gte: since }, duration: null },
  })
  const uniqueUsers = await db.pageView.findMany({
    where: { createdAt: { gte: since }, employeeId: { not: null }, duration: null },
    distinct: ["employeeId"],
    select: { employeeId: true },
  })
  const uniqueOrgs = await db.pageView.findMany({
    where: { createdAt: { gte: since }, tenantId: { not: null }, duration: null },
    distinct: ["tenantId"],
    select: { tenantId: true },
  })

  return NextResponse.json({
    days,
    totalViews,
    uniqueUsers: uniqueUsers.length,
    uniqueOrgs: uniqueOrgs.length,
    topPages: topPages.map((p) => ({
      path: p.path,
      views: p._count.id,
    })),
    avgDuration: avgDuration.map((p) => ({
      path: p.path,
      avgSeconds: Math.round(p._avg.duration || 0),
      sessions: p._count.id,
    })),
    orgActivity: orgActivity.map((o) => ({
      tenantId: o.tenantId,
      name: orgMap[o.tenantId!] || "—",
      views: o._count.id,
    })),
    dailyViews,
    dailyUsers,
  })
}
