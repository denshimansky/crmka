import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/** Восстановление направления из архива (снятие deletedAt). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.direction.findFirst({
    where: { id, tenantId: session.user.tenantId },
    select: { id: true, name: true, deletedAt: true },
  })
  if (!existing) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
  if (!existing.deletedAt) return NextResponse.json({ error: "Направление не в архиве" }, { status: 400 })

  // Нельзя восстановить, если активное направление уже заняло это название.
  const clash = await db.direction.findFirst({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
      id: { not: id },
      name: { equals: existing.name, mode: "insensitive" },
    },
    select: { id: true },
  })
  if (clash) {
    return NextResponse.json(
      { error: "Есть активное направление с таким названием — сначала переименуйте его" },
      { status: 409 },
    )
  }

  const direction = await db.direction.update({ where: { id }, data: { deletedAt: null } })
  return NextResponse.json(direction)
}
