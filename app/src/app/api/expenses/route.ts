import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { requirePermission } from "@/lib/api-permissions"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const MARKETING_CATEGORY_NAME = "Маркетинг и реклама"

const createSchema = z.object({
  categoryId: z.string().uuid("Выберите статью расхода"),
  accountId: z.string().uuid("Выберите счёт"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  date: z.string().min(1, "Укажите дату"),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  isVariable: z.boolean().optional(),
  isRecurring: z.boolean().optional().default(false),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized"]).optional().default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.any().transform(v => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }),
  branchIds: z.array(z.string().uuid()).optional().default([]),
  directionId: z.string().uuid().nullable().optional(),
  leadChannelId: z.string().uuid().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const guard = await requirePermission("finance.view")
  if (!guard.ok) return guard.response
  const session = guard.session

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
      leadChannel: { select: { id: true, name: true } },
      branches: {
        include: {
          branch: { select: { id: true, name: true } },
          direction: { select: { id: true, name: true } },
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

  // Канал привлечения — только для категории «Маркетинг и реклама».
  let resolvedLeadChannelId: string | null = null
  if (data.leadChannelId) {
    if (category.name !== MARKETING_CATEGORY_NAME) {
      return NextResponse.json(
        { error: "Канал привлечения можно указать только для статьи «Маркетинг и реклама»" },
        { status: 400 },
      )
    }
    const channel = await db.leadChannel.findFirst({
      where: { id: data.leadChannelId, tenantId: session.user.tenantId, isActive: true },
    })
    if (!channel) return NextResponse.json({ error: "Канал привлечения не найден" }, { status: 404 })
    resolvedLeadChannelId = channel.id
  }

  // Направление — проверим, что принадлежит тенанту.
  let resolvedDirectionId: string | null = null
  if (data.directionId) {
    const direction = await db.direction.findFirst({
      where: { id: data.directionId, tenantId: session.user.tenantId, deletedAt: null },
    })
    if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
    resolvedDirectionId = direction.id
  }

  // Проверка закрытия периода
  const role = (session.user as any).role
  if (await isPeriodLocked(session.user.tenantId, new Date(data.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Валидация режима признания расхода в ОПИУ.
  let recognitionAmortMonths: number | null = null
  let recognitionStartDate: Date | null = null
  if (data.recognitionMode === "single_period") {
    if (!data.amortizationStartDate) {
      return NextResponse.json({ error: "Укажите месяц признания для режима «Одной суммой в другом месяце»" }, { status: 400 })
    }
    recognitionStartDate = new Date(data.amortizationStartDate)
    recognitionAmortMonths = 1
  } else if (data.recognitionMode === "amortized") {
    if (!data.amortizationStartDate || !data.amortizationMonths || data.amortizationMonths < 2) {
      return NextResponse.json({ error: "Укажите месяц начала и количество месяцев (≥ 2) для амортизации" }, { status: 400 })
    }
    if (data.amortizationMonths > 60) {
      return NextResponse.json({ error: "Максимум 60 месяцев" }, { status: 400 })
    }
    recognitionStartDate = new Date(data.amortizationStartDate)
    recognitionAmortMonths = data.amortizationMonths
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
        recognitionMode: data.recognitionMode,
        amortizationMonths: recognitionAmortMonths,
        amortizationStartDate: recognitionStartDate,
        leadChannelId: resolvedLeadChannelId,
        createdBy: session.user.employeeId,
      },
      include: {
        category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Привязка к филиалам и направлению.
    // Если указаны филиалы — пишем строку на каждый филиал, направление дублируется.
    // Если филиалы не указаны, но указано направление — пишем одну строку (branchId=null).
    if (data.branchIds.length > 0) {
      await tx.expenseBranch.createMany({
        data: data.branchIds.map((branchId) => ({
          tenantId: session.user.tenantId,
          expenseId: e.id,
          branchId,
          directionId: resolvedDirectionId,
        })),
      })
    } else if (resolvedDirectionId) {
      await tx.expenseBranch.create({
        data: {
          tenantId: session.user.tenantId,
          expenseId: e.id,
          branchId: null,
          directionId: resolvedDirectionId,
        },
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
      leadChannel: { select: { id: true, name: true } },
      branches: {
        include: {
          branch: { select: { id: true, name: true } },
          direction: { select: { id: true, name: true } },
        },
      },
    },
  })

  return NextResponse.json(result, { status: 201 })
}
