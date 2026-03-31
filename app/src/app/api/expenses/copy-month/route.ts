import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const copySchema = z.object({
  sourceYear: z.number().int().min(2020),
  sourceMonth: z.number().int().min(1).max(12),
  targetYear: z.number().int().min(2020),
  targetMonth: z.number().int().min(1).max(12),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = copySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { sourceYear, sourceMonth, targetYear, targetMonth } = parsed.data

  // Берём повторяющиеся расходы из исходного месяца
  const sourceStart = new Date(sourceYear, sourceMonth - 1, 1)
  const sourceEnd = new Date(sourceYear, sourceMonth, 0) // last day

  const recurringExpenses = await db.expense.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
      isRecurring: true,
      date: { gte: sourceStart, lte: sourceEnd },
    },
    include: {
      branches: true,
    },
  })

  if (recurringExpenses.length === 0) {
    return NextResponse.json({ error: "Нет повторяющихся расходов за указанный месяц" }, { status: 400 })
  }

  const created = await db.$transaction(async (tx) => {
    const results = []

    for (const exp of recurringExpenses) {
      // Сохраняем тот же день, но в целевом месяце
      const sourceDay = exp.date.getDate()
      const lastDayOfTarget = new Date(targetYear, targetMonth, 0).getDate()
      const targetDay = Math.min(sourceDay, lastDayOfTarget)
      const targetDate = new Date(targetYear, targetMonth - 1, targetDay)

      const newExpense = await tx.expense.create({
        data: {
          tenantId: session.user.tenantId,
          categoryId: exp.categoryId,
          accountId: exp.accountId,
          amount: exp.amount,
          date: targetDate,
          comment: exp.comment,
          isVariable: exp.isVariable,
          isRecurring: true,
          recurringGroupId: exp.recurringGroupId || exp.id,
          createdBy: session.user.employeeId,
        },
      })

      // Копируем привязки к филиалам
      if (exp.branches.length > 0) {
        await tx.expenseBranch.createMany({
          data: exp.branches.map((b) => ({
            tenantId: session.user.tenantId,
            expenseId: newExpense.id,
            branchId: b.branchId,
            directionId: b.directionId,
          })),
        })
      }

      // Списываем с баланса счёта
      await tx.financialAccount.update({
        where: { id: exp.accountId },
        data: { balance: { decrement: exp.amount } },
      })

      results.push(newExpense)
    }

    return results
  })

  return NextResponse.json({ copied: created.length }, { status: 201 })
}
