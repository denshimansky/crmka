import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const branches = await db.branch.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(branches)
}
