import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Системные (tenantId = null) + пользовательские категории
  const categories = await db.expenseCategory.findMany({
    where: {
      OR: [
        { tenantId: null },
        { tenantId: session.user.tenantId },
      ],
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json(categories)
}
