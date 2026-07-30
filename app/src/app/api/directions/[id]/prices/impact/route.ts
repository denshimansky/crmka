import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/directions/[id]/prices/impact?from=YYYY-MM-DD  (баг #88)
//
// Сколько уже созданных абонементов будущего периода останутся по прежней цене при
// вводе новой цены с даты `from` — их слепок цены не пересчитывается. Показывается
// в предупреждении формы направления.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const direction = await db.direction.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  const from = req.nextUrl.searchParams.get("from")
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "Параметр from обязателен (ГГГГ-ММ-ДД)" }, { status: 400 })
  }
  const [y, m, d] = from.split("-").map(Number)
  const fromUtc = new Date(Date.UTC(y, m - 1, d))

  // Живые (pending/active) абонементы этого направления, чей старт >= даты новой
  // цены. Они уже несут слепок старой цены и не будут пересчитаны.
  const count = await db.subscription.count({
    where: {
      tenantId: session.user.tenantId,
      directionId: id,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      startDate: { gte: fromUtc },
    },
  })

  return NextResponse.json({ count })
}
