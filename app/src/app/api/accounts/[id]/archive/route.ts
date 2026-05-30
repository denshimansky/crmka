import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner") {
    return NextResponse.json(
      { error: "Архивировать счёт может только владелец" },
      { status: 403 }
    )
  }

  const { id } = await params
  const account = await db.financialAccount.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!account) {
    return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })
  }
  if (!account.isActive) {
    return NextResponse.json({ error: "Счёт уже архивирован" }, { status: 409 })
  }
  if (Math.abs(Number(account.balance)) > 0.005) {
    return NextResponse.json(
      { error: "Архивировать можно только счёт с нулевым балансом" },
      { status: 409 }
    )
  }

  const updated = await db.financialAccount.update({
    where: { id },
    data: { isActive: false },
  })

  return NextResponse.json({ ok: true, account: updated })
}
