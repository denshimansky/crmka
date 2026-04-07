import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const createSchema = z.object({
  categoryId: z.string().uuid("Выберите статью расхода"),
  accountId: z.string().uuid("Выберите счёт"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  date: z.string().min(1, "Укажите дату"),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  isVariable: z.boolean().optional(),
  isRecurring: z.boolean().optional().default(false),
  amortizationMonths: z.any().transform(v => {
    const n = Number(v)
    return n > 0 ? n : undefined
  }),
  branchIds: z.array(z.string().uuid()).optional().default([]),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")
  const categoryId = searchParams.get("categoryId")
  const branchId = searchParams.get("branchId")
  const accountId = searchParams.get("accountId")

  const where: Prisma.ExpenseWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  if (categoryId) where.categoryId = categoryId
  if (accountId) where.accountId = accountId

  if (dateFrom || dateTo) {
    where.date = {}
    if (dateFrom) (where.date as any).gte = new Date(dateFrom)
    if (dateTo) (where.date as any).lte = new Date(dateTo)
  }

  if (branchId) {
    where.branches = { some: { branchId } }
  }

  const expenses = await db.expense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      account: { select: { id: true, name: true } },
      branches: {
        include: {
          branch: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
    take: 500,
  })

  return NextResponse.json(expenses)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

  // Проверяем счёт
  const account = await db.financialAccount.findFirst({
    where: { id: data.accountId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  // Проверка закрытия периода
  const role = (session.user as any).role
  if (await isPeriodLocked(session.user.tenantId, new Date(data.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  const expense = await db.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: {
        tenantId: session.user.tenantId,
        categoryId: data.categoryId,
        accountId: data.accountId,
        amount: data.amount,
        date: new Date(data.date),
        comment: data.comment,
        isVariable: data.isVariable !== undefined ? data.isVariable : category.isVariable,
        isRecurring: data.isRecurring,
        amortizationMonths: data.amortizationMonths,
        amortizationStartDate: data.amortizationMonths ? new Date(data.date) : undefined,
        createdBy: session.user.employeeId,
      },
      include: {
        category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Привязка к филиалам
    if (data.branchIds.length > 0) {
      await tx.expenseBranch.createMany({
        data: data.branchIds.map((branchId) => ({
          tenantId: session.user.tenantId,
          expenseId: e.id,
          branchId,
        })),
      })
    }

    // Списываем с баланса счёта
    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { decrement: data.amount } },
    })

    return e
  })

  // Аудит
  logAudit({
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
    action: "create",
    entityType: "Expense",
    entityId: expense.id,
    changes: { amount: { new: data.amount }, categoryId: { new: data.categoryId }, accountId: { new: data.accountId } },
    req,
  })

  // Перезагружаем с branches
  const result = await db.expense.findUnique({
    where: { id: expense.id },
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      account: { select: { id: true, name: true } },
      branches: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  })

  return NextResponse.json(result, { status: 201 })
}
