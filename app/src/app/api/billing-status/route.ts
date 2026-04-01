import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/billing-status — статус биллинга текущей организации
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json(null)

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { billingStatus: true },
  })
  if (!org) return NextResponse.json(null)

  // Ищем активную подписку
  const subscription = await db.billingSubscription.findFirst({
    where: { organizationId: tenantId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    select: { nextPaymentDate: true },
  })

  let daysUntilPayment: number | undefined
  if (subscription) {
    const now = new Date()
    const next = new Date(subscription.nextPaymentDate)
    daysUntilPayment = Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  return NextResponse.json({
    billingStatus: org.billingStatus,
    daysUntilPayment,
  })
}
