import { NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"

// GET /api/admin/login-attempts — лог попыток входа
export async function GET(req: Request) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = Math.min(Number(searchParams.get("days")) || 7, 90)
  const onlyFailed = searchParams.get("failed") === "true"

  const since = new Date()
  since.setDate(since.getDate() - days)

  const attempts = await db.loginAttempt.findMany({
    where: {
      createdAt: { gte: since },
      ...(onlyFailed ? { success: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      organization: { select: { name: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
  })

  // Сводка по IP с неудачными попытками (подозрительные)
  const suspiciousIps: { ip: string; count: number }[] = await db.$queryRaw`
    SELECT ip_address as ip, COUNT(*)::int as count
    FROM login_attempts
    WHERE created_at >= ${since} AND success = false AND ip_address IS NOT NULL
    GROUP BY ip_address
    HAVING COUNT(*) >= 3
    ORDER BY count DESC
    LIMIT 20
  `

  // Общая статистика
  const stats = {
    total: attempts.length,
    successful: attempts.filter((a) => a.success).length,
    failed: attempts.filter((a) => !a.success).length,
    blocked: attempts.filter((a) => a.reason === "blocked_brute_force").length,
    uniqueIps: new Set(attempts.map((a) => a.ipAddress).filter(Boolean)).size,
  }

  return NextResponse.json({
    stats,
    suspiciousIps,
    attempts: attempts.map((a) => ({
      id: a.id,
      login: a.login,
      success: a.success,
      reason: a.reason,
      ip: a.ipAddress,
      userAgent: a.userAgent,
      orgName: a.organization?.name,
      employeeName: a.employee
        ? `${a.employee.lastName} ${a.employee.firstName}`
        : null,
      createdAt: a.createdAt,
    })),
  })
}
