import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { logAudit, diffChanges } from "@/lib/audit"

const MARKETING_CATEGORY_NAME = "Маркетинг и реклама"

const updateSchema = z.object({
  categoryId: z.string().uuid("Выберите статью расхода").optional(),
  accountId: z.string().uuid("Выберите счёт").optional(),
  amount: z.number().min(0.01, "Сумма должна быть больше 0").optional(),
  date: z.string().min(1, "Укажите дату").optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  isVariable: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).optional(),
  amortizationStartDate: z.string().nullable().optional(),
  amortizationMonths: z.any().transform(v => {
    if (v === null) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }),
  branchIds: z.array(z.string().uuid()).optional(),
  directionId: z.string().uuid().nullable().optional(),
  leadChannelId: z.string().uuid().nullable().optional(),
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

  // Расход без счёта (списание товара) обязан быть в ОПИУ — режим «не в финрезе»
  // оставил бы его и без ОПИУ, и без ДДС (остаток склада уже списан). Запрещаем.
  const willHaveAccount = data.accountId !== undefined ? !!data.accountId : !!existing.accountId
  if (data.recognitionMode === "not_in_pnl" && !willHaveAccount) {
    return NextResponse.json({ error: "Списание товара нельзя исключить из финреза" }, { status: 400 })
  }

  // Валидация режима признания (если он передан в запросе).
  if (data.recognitionMode === "single_period") {
    if (!data.amortizationStartDate) {
      return NextResponse.json({ error: "Укажите месяц признания для режима «Одной суммой в другом месяце»" }, { status: 400 })
    }
  } else if (data.recognitionMode === "amortized") {
    if (!data.amortizationStartDate || !data.amortizationMonths || data.amortizationMonths < 2) {
      return NextResponse.json({ error: "Укажите месяц начала и количество месяцев (≥ 2) для амортизации" }, { status: 400 })
    }
    if (data.amortizationMonths > 60) {
      return NextResponse.json({ error: "Максимум 60 месяцев" }, { status: 400 })
    }
  }

  // Если меняется категория или передан leadChannelId — нужно проверить,
  // что канал применим только к «Маркетинг и реклама».
  let resolvedLeadChannelId: string | null | undefined = undefined
  if (data.leadChannelId !== undefined) {
    if (data.leadChannelId === null) {
      resolvedLeadChannelId = null
    } else {
      const targetCategoryId = data.categoryId ?? existing.categoryId
      const targetCategory = await db.expenseCategory.findFirst({
        where: { id: targetCategoryId },
      })
      if (!targetCategory || targetCategory.name !== MARKETING_CATEGORY_NAME) {
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
  } else if (data.categoryId && data.categoryId !== existing.categoryId) {
    // Категорию сменили на немаркетинговую — снимаем привязку к каналу.
    const newCategory = await db.expenseCategory.findFirst({ where: { id: data.categoryId } })
    if (newCategory && newCategory.name !== MARKETING_CATEGORY_NAME && existing.leadChannelId) {
      resolvedLeadChannelId = null
    }
  }

  // Направление: проверяем принадлежность тенанту.
  let resolvedDirectionId: string | null | undefined = undefined
  if (data.directionId !== undefined) {
    if (data.directionId === null) {
      resolvedDirectionId = null
    } else {
      const direction = await db.direction.findFirst({
        where: { id: data.directionId, tenantId: session.user.tenantId, deletedAt: null },
      })
      if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
      resolvedDirectionId = direction.id
    }
  }

  await db.$transaction(async (tx) => {
    const updateData: any = {}
    if (data.categoryId) updateData.categoryId = data.categoryId
    if (data.date) updateData.date = new Date(data.date)
    if (data.comment !== undefined) updateData.comment = data.comment || null
    if (data.isVariable !== undefined) updateData.isVariable = data.isVariable
    if (data.isRecurring !== undefined) updateData.isRecurring = data.isRecurring
    if (resolvedLeadChannelId !== undefined) updateData.leadChannelId = resolvedLeadChannelId

    if (data.recognitionMode !== undefined) {
      updateData.recognitionMode = data.recognitionMode
      if (data.recognitionMode === "by_payment_date" || data.recognitionMode === "not_in_pnl") {
        // Эти режимы не используют поля амортизации — обнуляем.
        updateData.amortizationMonths = null
        updateData.amortizationStartDate = null
      } else if (data.recognitionMode === "single_period") {
        updateData.amortizationMonths = 1
        updateData.amortizationStartDate = data.amortizationStartDate ? new Date(data.amortizationStartDate) : null
      } else if (data.recognitionMode === "amortized") {
        updateData.amortizationMonths = data.amortizationMonths ?? null
        updateData.amortizationStartDate = data.amortizationStartDate ? new Date(data.amortizationStartDate) : null
      }
    }

    // Если меняется сумма или счёт — корректируем балансы
    if (data.amount !== undefined || data.accountId !== undefined) {
      const newAmount = data.amount ?? Number(existing.amount)
      const newAccountId = data.accountId ?? existing.accountId
      const oldAmount = Number(existing.amount)

      // Возвращаем старую сумму на старый счёт (если он был — у списаний товара счёта нет).
      if (existing.accountId) {
        await tx.financialAccount.update({
          where: { id: existing.accountId },
          data: { balance: { increment: oldAmount } },
        })
      }
      // Списываем новую сумму с нового счёта (если он есть).
      if (newAccountId) {
        await tx.financialAccount.update({
          where: { id: newAccountId },
          data: { balance: { decrement: newAmount } },
        })
      }

      if (data.amount !== undefined) updateData.amount = data.amount
      if (data.accountId !== undefined) updateData.accountId = data.accountId
    }

    await tx.expense.update({ where: { id }, data: updateData })

    // Обновляем привязку к филиалам и направлению.
    // Перезаписываем только если хотя бы одно из (branchIds, directionId)
    // присутствует в payload — иначе ничего не трогаем.
    const branchesChanged = data.branchIds !== undefined
    const directionChanged = resolvedDirectionId !== undefined
    if (branchesChanged || directionChanged) {
      // Определяем итоговый список филиалов и направление с учётом существующих
      // значений (если что-то не передано — сохраняем как есть).
      let finalBranchIds: string[]
      if (branchesChanged) {
        finalBranchIds = data.branchIds!
      } else {
        const existingBranches = await tx.expenseBranch.findMany({
          where: { expenseId: id },
          select: { branchId: true },
        })
        finalBranchIds = existingBranches.map((b) => b.branchId).filter((b): b is string => !!b)
      }
      let finalDirectionId: string | null
      if (directionChanged) {
        finalDirectionId = resolvedDirectionId!
      } else {
        const existingBranches = await tx.expenseBranch.findMany({
          where: { expenseId: id },
          select: { directionId: true },
          take: 1,
        })
        finalDirectionId = existingBranches[0]?.directionId ?? null
      }

      await tx.expenseBranch.deleteMany({ where: { expenseId: id } })
      if (finalBranchIds.length > 0) {
        await tx.expenseBranch.createMany({
          data: finalBranchIds.map((branchId) => ({
            tenantId: session.user.tenantId,
            expenseId: id,
            branchId,
            directionId: finalDirectionId,
          })),
        })
      } else if (finalDirectionId) {
        await tx.expenseBranch.create({
          data: {
            tenantId: session.user.tenantId,
            expenseId: id,
            branchId: null,
            directionId: finalDirectionId,
          },
        })
      }
    }
  })

  const result = await db.expense.findUnique({
    where: { id },
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

  const changes = diffChanges(existing as any, { ...existing, ...data } as any, ["categoryId", "accountId", "amount", "date", "comment", "isVariable", "isRecurring", "amortizationMonths"])
  if (changes) {
    logAudit({
      tenantId: session.user.tenantId,
      employeeId: (session.user as any).employeeId,
      action: "update",
      entityType: "Expense",
      entityId: id,
      changes,
      req,
    })
  }

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
    // Возвращаем сумму на счёт (если он был — у списаний товара счёта нет).
    if (existing.accountId) {
      await tx.financialAccount.update({
        where: { id: existing.accountId },
        data: { balance: { increment: Number(existing.amount) } },
      })
    }

    // Soft delete
    await tx.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  })

  logAudit({
    tenantId: session.user.tenantId,
    employeeId: (session.user as any).employeeId,
    action: "delete",
    entityType: "Expense",
    entityId: id,
    changes: { amount: { old: Number(existing.amount) }, categoryId: { old: existing.categoryId } },
    req,
  })

  return NextResponse.json({ success: true })
}
