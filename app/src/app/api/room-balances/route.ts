import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const balances = await db.roomBalance.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      stockItem: { select: { id: true, name: true, unit: true } },
      room: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { room: { name: "asc" } },
  })

  return NextResponse.json(balances)
}
