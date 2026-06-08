import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  BONUS_TYPES,
  TYPE_TO_FIELD,
  emptyAmounts,
  upsertScopeBonus,
  type BonusType,
} from "@/lib/admin-bonus"

const globalBodySchema = z.object({
  trialBonus: z.number().min(0).nullable().optional(),
  saleBonus: z.number().min(0).nullable().optional(),
  upsaleBonus: z.number().min(0).nullable().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const rows = await db.adminBonusSettings.findMany({
    where: { tenantId, isActive: true },
    include: {
      branch: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  const global = emptyAmounts()
  const branchMap = new Map<
    string,
    { id: string; branchId: string; branchName: string } & ReturnType<typeof emptyAmounts>
  >()
  const employeeMap = new Map<
    string,
    { id: string; employeeId: string; employeeName: string } & ReturnType<typeof emptyAmounts>
  >()

  for (const row of rows) {
    const field = TYPE_TO_FIELD[row.bonusType as BonusType]
    const amount = row.amount === null ? null : Number(row.amount)

    if (!row.branchId && !row.employeeId) {
      global[field] = amount
    } else if (row.branchId && !row.employeeId) {
      let entry = branchMap.get(row.branchId)
      if (!entry) {
        entry = {
          id: row.branchId,
          branchId: row.branchId,
          branchName: row.branch?.name ?? "—",
          ...emptyAmounts(),
        }
        branchMap.set(row.branchId, entry)
      }
      entry[field] = amount
    } else if (!row.branchId && row.employeeId) {
      let entry = employeeMap.get(row.employeeId)
      if (!entry) {
        const fullName = row.employee
          ? [row.employee.lastName, row.employee.firstName].filter(Boolean).join(" ").trim() || "—"
          : "—"
        entry = {
          id: row.employeeId,
          employeeId: row.employeeId,
          employeeName: fullName,
          ...emptyAmounts(),
        }
        employeeMap.set(row.employeeId, entry)
      }
      entry[field] = amount
    }
  }

  return NextResponse.json({
    global,
    branchOverrides: Array.from(branchMap.values()),
    employeeOverrides: Array.from(employeeMap.values()),
  })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = globalBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const tenantId = session.user.tenantId
  for (const bonusType of BONUS_TYPES) {
    const field = TYPE_TO_FIELD[bonusType]
    const incoming = parsed.data[field]
    if (incoming === undefined) continue
    await upsertScopeBonus(tenantId, null, null, bonusType, incoming)
  }

  return NextResponse.json({ ok: true })
}
