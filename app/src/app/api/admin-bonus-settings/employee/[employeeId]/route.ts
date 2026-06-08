import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  BONUS_TYPES,
  FIELD_TO_TYPE,
  upsertScopeBonus,
  type BonusField,
} from "@/lib/admin-bonus"

const patchSchema = z.object({
  trialBonus: z.number().min(0).nullable().optional(),
  saleBonus: z.number().min(0).nullable().optional(),
  upsaleBonus: z.number().min(0).nullable().optional(),
})

async function requireWriter() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return { error: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) }
  }
  return { session }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const auth = await requireWriter()
  if (auth.error) return auth.error
  const { session } = auth
  const tenantId = session.user.tenantId

  const { employeeId } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  for (const field of Object.keys(parsed.data) as BonusField[]) {
    const value = parsed.data[field]
    if (value === undefined) continue
    await upsertScopeBonus(tenantId, null, employeeId, FIELD_TO_TYPE[field], value)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const auth = await requireWriter()
  if (auth.error) return auth.error
  const { session } = auth
  const tenantId = session.user.tenantId

  const { employeeId } = await params
  await db.adminBonusSettings.deleteMany({
    where: {
      tenantId,
      branchId: null,
      employeeId,
      bonusType: { in: BONUS_TYPES },
    },
  })
  return NextResponse.json({ ok: true })
}
