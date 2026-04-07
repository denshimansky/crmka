import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/audit — журнал действий (только owner)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner") {
    return NextResponse.json({ error: "Журнал действий доступен только владельцу" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")
  const entityId = searchParams.get("entityId")
  const employeeId = searchParams.get("employeeId")
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50))

  const where: any = {
    tenantId: session.user.tenantId,
  }
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  if (employeeId) where.employeeId = employeeId
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(dateFrom)
    if (dateTo) where.createdAt.lte = new Date(dateTo)
  }

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.auditLog.count({ where }),
  ])

  return NextResponse.json({ logs, total, page, limit })
}
