import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// Остатки общего склада организации (одна локация на тенант, без привязки к филиалу).
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const balances = await db.warehouseBalance.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      stockItem: { select: { id: true, name: true, unit: true } },
    },
    orderBy: { stockItem: { name: "asc" } },
  })

  return NextResponse.json(balances)
}
