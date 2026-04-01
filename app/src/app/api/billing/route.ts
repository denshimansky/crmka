import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/billing — подписка текущей организации
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Доступ только для владельца и управляющего" }, { status: 403 })
  }

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      legalName: true,
      inn: true,
      phone: true,
      email: true,
      billingStatus: true,
    },
  })

  const subscription = await db.billingSubscription.findFirst({
    where: { organizationId: tenantId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
    },
  })

  const invoices = await db.billingInvoice.findMany({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  // Статистика
  const totalPaid = await db.billingInvoice.aggregate({
    where: { organizationId: tenantId, status: "paid" },
    _sum: { paidAmount: true },
    _count: true,
  })

  const branchCount = await db.branch.count({
    where: { tenantId, deletedAt: null },
  })

  return NextResponse.json({
    organization: org,
    subscription,
    invoices,
    stats: {
      totalPaid: totalPaid._sum.paidAmount || 0,
      invoicesPaid: totalPaid._count || 0,
      branchCount,
    },
  })
}
