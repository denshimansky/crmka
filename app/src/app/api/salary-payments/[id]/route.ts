import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { z } from "zod"
import { buildOkladTwinExpenses } from "@/lib/salary/oklad-twin"
import { getOkladCategoryId } from "@/lib/salary/oklad-category"

// Правка выплаты: заменяет строки выплаты целиком (по направлениям/счетам), чтобы
// мульти-направленная оклад-выплата не схлопывалась в одну строку/один твин.
const patchSchema = z.object({
  date: z.string().min(1),
  items: z.array(z.object({
    accountId: z.string().uuid(),
    directionId: z.string().uuid().nullable().optional(),
    amount: z.number().min(0.01),
    comment: z.string().optional().nullable(),
  })).min(1, "Добавьте хотя бы одну строку выплаты"),
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
    select: {
      id: true, accountId: true, amount: true, periodYear: true, periodMonth: true,
      items: { select: { accountId: true, amount: true } },
    },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  await db.$transaction(async (tx) => {
    // Вернуть деньги на счета по ФАКТИЧЕСКИМ позициям (выплата может быть разнесена
    // по нескольким счетам — откат по шапке был бы неверен). Фолбэк на шапку, если
    // позиций почему-то нет.
    const byAccount = new Map<string, number>()
    for (const it of payment.items) byAccount.set(it.accountId, (byAccount.get(it.accountId) || 0) + Number(it.amount))
    if (byAccount.size === 0) byAccount.set(payment.accountId, Number(payment.amount))
    for (const [acc, sum] of byAccount) {
      await tx.financialAccount.update({ where: { id: acc }, data: { balance: { increment: sum } } })
    }
    // Твин-Expense, SalaryPaymentItem и связанные премии/штрафы (salary_payment_id)
    // удаляются каскадом по FK ON DELETE CASCADE. Явно удаляем шапку выплаты.
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
    select: {
      id: true, employeeId: true, periodYear: true, periodMonth: true,
      opiuExpenses: { select: { id: true } },
      items: { select: { accountId: true, amount: true } },
    },
  })
  if (!payment) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(payment.periodYear, payment.periodMonth - 1, 1)), g.role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Валидируем новые счета/направления в рамках тенанта.
  const accountIds = Array.from(new Set(data.items.map((i) => i.accountId)))
  const directionIds = Array.from(new Set(data.items.map((i) => i.directionId).filter((v): v is string => !!v)))
  const [accounts, directions] = await Promise.all([
    db.financialAccount.findMany({ where: { id: { in: accountIds }, tenantId }, select: { id: true } }),
    directionIds.length > 0
      ? db.direction.findMany({ where: { id: { in: directionIds }, tenantId }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ])
  if (accounts.length !== accountIds.length) return NextResponse.json({ error: "Один или несколько счетов не найдены" }, { status: 404 })
  if (directions.length !== directionIds.length) return NextResponse.json({ error: "Одно или несколько направлений не найдены" }, { status: 404 })

  // Была ли выплата оклад-типа (есть твин) — тогда пересоздаём твин. Категорию
  // резолвим ДО money-транзакции.
  const isSalary = payment.opiuExpenses.length > 0
  const okladCategoryId = isSalary ? await getOkladCategoryId() : null
  const newAmount = data.items.reduce((s, it) => s + it.amount, 0)

  await db.$transaction(async (tx) => {
    // Откат старого баланса по счетам старых позиций + применение нового по счетам новых.
    const oldByAccount = new Map<string, number>()
    for (const it of payment.items) oldByAccount.set(it.accountId, (oldByAccount.get(it.accountId) || 0) + Number(it.amount))
    for (const [acc, sum] of oldByAccount) {
      await tx.financialAccount.update({ where: { id: acc }, data: { balance: { increment: sum } } })
    }
    const newByAccount = new Map<string, number>()
    for (const it of data.items) newByAccount.set(it.accountId, (newByAccount.get(it.accountId) || 0) + it.amount)
    for (const [acc, sum] of newByAccount) {
      await tx.financialAccount.update({ where: { id: acc }, data: { balance: { decrement: sum } } })
    }

    // Шапка (представительные employeeId/accountId/amount) + позиции.
    await tx.salaryPayment.update({
      where: { id: payment.id },
      data: { accountId: data.items[0].accountId, amount: newAmount, date: new Date(data.date) },
    })
    await tx.salaryPaymentItem.deleteMany({ where: { salaryPaymentId: payment.id } })
    await tx.salaryPaymentItem.createMany({
      data: data.items.map((it) => ({
        tenantId,
        salaryPaymentId: payment.id,
        employeeId: payment.employeeId,
        accountId: it.accountId,
        directionId: it.directionId ?? null,
        amount: it.amount,
        comment: it.comment ?? null,
      })),
    })

    // Пересоздать твин(ы) по направлениям (только если выплата оклад-типа).
    await tx.expense.deleteMany({ where: { salaryPaymentId: payment.id } })
    if (isSalary && okladCategoryId) {
      const twins = buildOkladTwinExpenses({
        tenantId, categoryId: okladCategoryId, salaryPaymentId: payment.id, date: new Date(data.date),
        recognitionMode: data.recognitionMode,
        amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
        amortizationMonths: data.amortizationMonths ?? null,
        createdBy: actor ?? null,
        items: data.items.map((it) => ({ directionId: it.directionId ?? null, amount: it.amount })),
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
    changes: { amount: { new: newAmount }, items: { new: data.items.length } }, req,
  })
  return NextResponse.json({ ok: true })
}
