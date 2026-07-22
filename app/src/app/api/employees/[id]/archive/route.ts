import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const schema = z.object({ archived: z.boolean() })

// Архив сотрудника = isActive:false (без deletedAt). Уволенный сотрудник
// уходит вниз списка и не может войти в аккаунт (см. authorize в lib/auth.ts,
// где вход требует isActive:true) — пока владелец или управляющий не вернёт его.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  const { archived } = parsed.data

  const existing = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  }
  if (existing.role === "owner") {
    return NextResponse.json({ error: "Нельзя архивировать владельца" }, { status: 400 })
  }

  await db.employee.update({
    where: { id },
    data: { isActive: !archived },
  })

  return NextResponse.json({ ok: true })
}
