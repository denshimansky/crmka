import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { computePlannedExpensesWithFact } from "@/lib/finance/planned-expenses"
import { z } from "zod"

const createSchema = z.object({
  categoryId: z.string().uuid("Выберите статью расхода"),
  // employeeId / branchId с фронта приходят как null для «без сотрудника» /
  // «общее по компании». .optional() сам по себе null не принимает — добавляем
  // .nullable(), чтобы получить «string | null | undefined».
  employeeId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  periodYear: z.number().int().min(2020).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  plannedAmount: z.number().min(0, "Сумма должна быть >= 0"),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year")
  const month = searchParams.get("month")
  const categoryId = searchParams.get("categoryId")
  const branchId = searchParams.get("branchId")

  const result = await computePlannedExpensesWithFact(db, {
    tenantId: session.user.tenantId,
    year: year ? parseInt(year, 10) : undefined,
    month: month ? parseInt(month, 10) : undefined,
    categoryId: categoryId || undefined,
    branchId: branchId || undefined,
  })

  return NextResponse.json(result)
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

  // Проверяем категорию
  const category = await db.expenseCategory.findFirst({
    where: {
      id: data.categoryId,
      OR: [{ tenantId: null }, { tenantId: session.user.tenantId }],
      isActive: true,
    },
  })
  if (!category) return NextResponse.json({ error: "Статья расхода не найдена" }, { status: 404 })

  if (data.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: data.branchId, tenantId: session.user.tenantId, deletedAt: null },
      select: { id: true },
    })
    if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  }

  const item = await db.plannedExpense.create({
    data: {
      tenantId: session.user.tenantId,
      categoryId: data.categoryId,
      employeeId: data.employeeId,
      branchId: data.branchId,
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      plannedAmount: data.plannedAmount,
      comment: data.comment,
    },
    include: {
      category: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({
    id: item.id,
    periodYear: item.periodYear,
    periodMonth: item.periodMonth,
    categoryId: item.categoryId,
    categoryName: item.category.name,
    branchId: item.branchId,
    branchName: item.branch?.name ?? null,
    plannedAmount: Number(item.plannedAmount),
    actualAmount: 0,
    comment: item.comment,
  }, { status: 201 })
}
