import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  categoryId: z.string().uuid("Выберите статью расхода").optional(),
  accountId: z.string().uuid("Выберите счёт").optional(),
  amount: z.number().min(0.01, "Сумма должна быть больше 0").optional(),
  date: z.string().min(1, "Укажите дату").optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  isVariable: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  amortizationMonths: z.any().transform(v => {
    const n = Number(v)
    return n > 0 ? n : null
  }),
  branchIds: z.array(z.string().uuid()).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const existing = await db.expense.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Расход не найден" }, { status: 404 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  await db.$transaction(async (tx) => {
    const updateData: any = {}
    if (data.categoryId) updateData.categoryId = data.categoryId
    if (data.date) updateData.date = new Date(data.date)
    if (data.comment !== undefined) updateData.comment = data.comment || null
    if (data.isVariable !== undefined) updateData.isVariable = data.isVariable
    if (data.isRecurring !== undefined) updateData.isRecurring = data.isRecurring
    if (data.amortizationMonths !== undefined) {
      updateData.amortizationMonths = data.amortizationMonths
      updateData.amortizationStartDate = data.amortizationMonths ? (data.date ? new Date(data.date) : existing.date) : null
    }

    // Если меняется сумма или счёт — корректируем балансы
    if (data.amount !== undefined || data.accountId !== undefined) {
      const newAmount = data.amount ?? Number(existing.amount)
      const newAccountId = data.accountId ?? existing.accountId
      const oldAmount = Number(existing.amount)

      // Возвращаем старую сумму на старый счёт
      await tx.financialAccount.update({
        where: { id: existing.accountId },
        data: { balance: { increment: oldAmount } },
      })
      // Списываем новую сумму с нового счёта
      await tx.financialAccount.update({
        where: { id: newAccountId },
        data: { balance: { decrement: newAmount } },
      })

      if (data.amount !== undefined) updateData.amount = data.amount
      if (data.accountId !== undefined) updateData.accountId = data.accountId
    }

    await tx.expense.update({ where: { id }, data: updateData })

    // Обновляем привязку к филиалам
    if (data.branchIds !== undefined) {
      await tx.expenseBranch.deleteMany({ where: { expenseId: id } })
      if (data.branchIds.length > 0) {
        await tx.expenseBranch.createMany({
          data: data.branchIds.map((branchId) => ({
            tenantId: session.user.tenantId,
            expenseId: id,
            branchId,
          })),
        })
      }
    }
  })

  const result = await db.expense.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, isSalary: true, isVariable: true } },
      account: { select: { id: true, name: true } },
      branches: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  })

  return NextResponse.json(result)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const existing = await db.expense.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Расход не найден" }, { status: 404 })

  await db.$transaction(async (tx) => {
    // Возвращаем сумму на счёт
    await tx.financialAccount.update({
      where: { id: existing.accountId },
      data: { balance: { increment: Number(existing.amount) } },
    })

    // Soft delete
    await tx.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  })

  return NextResponse.json({ success: true })
}
