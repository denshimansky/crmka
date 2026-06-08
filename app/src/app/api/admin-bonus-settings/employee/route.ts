import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { BONUS_TYPES, upsertScopeBonus } from "@/lib/admin-bonus"

const schema = z.object({
  employeeId: z.string().uuid("Некорректный сотрудник"),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const tenantId = session.user.tenantId
  const employee = await db.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  for (const bonusType of BONUS_TYPES) {
    await upsertScopeBonus(tenantId, null, employee.id, bonusType, null)
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
