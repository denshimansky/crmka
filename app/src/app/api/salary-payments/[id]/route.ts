import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { z } from "zod"
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"

const OKLAD_EXPENSE_CATEGORY_NAME = "Зарплата окладников"

async function getOkladCategoryId(tx: { expenseCategory: any }): Promise<string> {
  const existing = await tx.expenseCategory.findFirst({
    where: { name: OKLAD_EXPENSE_CATEGORY_NAME, tenantId: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.expenseCategory.create({
    data: { tenantId: null, name: OKLAD_EXPENSE_CATEGORY_NAME, isSalary: true, isVariable: false, isSystem: true, isActive: true, sortOrder: 14 },
    select: { id: true },
  })
  return created.id
}

const patchSchema = z.object({
  amount: z.number().min(0.01),
  accountId: z.string().uuid(),
  date: z.string().min(1),
  directionId: z.string().uuid().nullable().optional(),
  recognitionMode: z.enum(["by_payment_date", "single_period", "amortized", "not_in_pnl"]).default("by_payment_date"),
  amortizationStartDate: z.string().optional().nullable(),
  amortizationMonths: z.number().int().min(1).max(60).optional().nullable(),
})

function gate(session: any) {
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return { error: NextResponse.json({ error: "Редактирование выплат доступно только владельцу и управляющему" }, { status: 403 }) }
  }
  return { role }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const g = gate(session)
  if (g.error) return g.error
  const { id } = await params
  const tenantId = session!.user.tenantId
  const actor = session!.user.employeeId

  const payment = await db.salaryPayment.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true, amount: true, periodYear: true, periodMonth: true },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  await db.$transaction(async (tx) => {
    // Вернуть деньги на счёт.
    await tx.financialAccount.update({ where: { id: payment.accountId }, data: { balance: { increment: payment.amount } } })
    // Твин-Expense удалятся каскадом по FK (expenses.salary_payment_id ON DELETE CASCADE),
    // SalaryPaymentItem — каскадом по своей связи. Явно удаляем шапку выплаты.
    await tx.salaryPayment.delete({ where: { id: payment.id } })
  })

  logAudit({
    tenantId, employeeId: actor, action: "delete", entityType: "SalaryPayment", entityId: payment.id,
    changes: { amount: { old: Number(payment.amount) } }, req,
  })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const g = gate(session)
  if (g.error) return g.error
  const { id } = await params
  const tenantId = session!.user.tenantId
  const actor = session!.user.employeeId

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  const data = parsed.data

  const payment = await db.salaryPayment.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true, amount: true, employeeId: true, periodYear: true, periodMonth: true, opiuExpenses: { select: { id: true } } },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }
  const account = await db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  const isSalary = payment.opiuExpenses.length > 0 // была ли выплата оклад-типа (есть твин)

  await db.$transaction(async (tx) => {
    // Откат старого баланса и применение нового (счёт мог смениться).
    await tx.financialAccount.update({ where: { id: payment.accountId }, data: { balance: { increment: payment.amount } } })
    await tx.financialAccount.update({ where: { id: data.accountId }, data: { balance: { decrement: data.amount } } })

    // Обновить шапку и зеркальную позицию.
    await tx.salaryPayment.update({
      where: { id: payment.id },
      data: { accountId: data.accountId, amount: data.amount, date: new Date(data.date) },
    })
    await tx.salaryPaymentItem.deleteMany({ where: { salaryPaymentId: payment.id } })
    await tx.salaryPaymentItem.create({
      data: { tenantId, salaryPaymentId: payment.id, employeeId: payment.employeeId, accountId: data.accountId, directionId: data.directionId ?? null, amount: data.amount },
    })

    // Пересоздать твин (только если выплата оклад-типа).
    await tx.expense.deleteMany({ where: { salaryPaymentId: payment.id } })
    if (isSalary) {
      const okladCategoryId = await getOkladCategoryId(tx)
      const twins = buildOkladTwinExpenses({
        tenantId, categoryId: okladCategoryId, salaryPaymentId: payment.id, date: new Date(data.date),
        recognitionMode: data.recognitionMode,
        amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
        amortizationMonths: data.amortizationMonths ?? null,
        createdBy: actor ?? null,
        items: [{ directionId: data.directionId ?? null, amount: data.amount }],
      })
      for (const t of twins) {
        const exp = await tx.expense.create({
          data: {
            tenantId, categoryId: t.categoryId, accountId: null, amount: t.amount, date: t.date,
            recognitionMode: t.recognitionMode, amortizationStartDate: t.amortizationStartDate, amortizationMonths: t.amortizationMonths,
            isVariable: false, salaryPaymentId: t.salaryPaymentId, createdBy: t.createdBy,
          },
          select: { id: true },
        })
        if (t.directionId) {
          await tx.expenseBranch.create({ data: { tenantId, expenseId: exp.id, branchId: null, directionId: t.directionId } })
        }
      }
    }
  })

  logAudit({
    tenantId, employeeId: actor, action: "update", entityType: "SalaryPayment", entityId: payment.id,
    changes: { amount: { old: Number(payment.amount), new: data.amount } }, req,
  })
  return NextResponse.json({ ok: true })
}
