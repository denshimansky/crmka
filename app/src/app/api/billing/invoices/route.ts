import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/billing/invoices — все счета текущей организации
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Доступ только для владельца и управляющего" }, { status: 403 })
  }

  const tenantId = (session.user as any).tenantId

  const invoices = await db.billingInvoice.findMany({
    where: { organizationId: tenantId },
    include: {
      subscription: {
        select: { plan: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(invoices)
}
