import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  branchId: z.string().uuid().optional(),
  employeeId: z.string().uuid("Укажите сотрудника"),
  bonusType: z.enum(["per_trial", "per_sale", "per_upsale"]),
  amount: z.number().min(0, "Сумма не может быть отрицательной"),
  channels: z.any().optional(),
  isActive: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get("employeeId")
  const branchId = searchParams.get("branchId")
  const bonusType = searchParams.get("bonusType")

  const where: any = {
    tenantId: session.user.tenantId,
  }

  if (employeeId) where.employeeId = employeeId
  if (branchId) where.branchId = branchId
  if (bonusType) where.bonusType = bonusType

  const items = await db.adminBonusSettings.findMany({
    where,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем сотрудника
  const employee = await db.employee.findFirst({
    where: { id: data.employeeId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  const item = await db.adminBonusSettings.create({
    data: {
      tenantId: session.user.tenantId,
      branchId: data.branchId,
      employeeId: data.employeeId,
      bonusType: data.bonusType,
      amount: data.amount,
      channels: data.channels,
      isActive: data.isActive,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(item, { status: 201 })
}
