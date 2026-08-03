import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { requirePermission } from "@/lib/api-permissions"
import { logAudit } from "@/lib/audit"
import { balanceSchema } from "@/lib/account-balance"

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  type: z.enum(["cash", "bank_account", "acquiring", "online"], {
    errorMap: () => ({ message: "Выберите тип счёта" }),
  }),
  branchId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  balance: balanceSchema,
})

export async function GET(_req: NextRequest) {
  const guard = await requirePermission("finance.view")
  if (!guard.ok) return guard.response
  const session = guard.session

  const accounts = await db.financialAccount.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
      isActive: true,
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(accounts)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json(
      { error: "Недостаточно прав для создания счёта" },
      { status: 403 }
    )
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Начальный остаток обязателен при создании счёта (03.08.2026): balanceSchema
  // возвращает undefined для пустого значения — явно это отклоняем.
  if (data.balance === undefined) {
    return NextResponse.json(
      { error: "Укажите начальный остаток. Если он нулевой — впишите 000" },
      { status: 400 }
    )
  }

  if (data.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: data.branchId, tenantId: session.user.tenantId, deletedAt: null },
      select: { id: true },
    })
    if (!branch) {
      return NextResponse.json({ error: "Филиал не найден" }, { status: 400 })
    }
  }

  const account = await db.financialAccount.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      type: data.type,
      branchId: data.branchId,
      ...(data.balance !== undefined && { balance: data.balance }),
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  })

  if (data.balance !== undefined && data.balance !== 0) {
    logAudit({
      tenantId: session.user.tenantId,
      employeeId: session.user.employeeId,
      action: "create",
      entityType: "FinancialAccount",
      entityId: account.id,
      changes: { balance: { new: data.balance } },
      req,
    })
  }

  return NextResponse.json(account, { status: 201 })
}
