import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { logAudit } from "@/lib/audit"

const createSchema = z.object({
  employeeId: z.string().uuid("Выберите сотрудника"),
  accountId: z.string().uuid("Выберите счёт"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  date: z.string().min(1, "Укажите дату"),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  periodHalf: z.any().transform(v => {
    const n = Number(v)
    return n === 1 || n === 2 ? n : undefined
  }),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodYear = Number(searchParams.get("periodYear")) || new Date().getFullYear()
  const periodMonth = Number(searchParams.get("periodMonth")) || new Date().getMonth() + 1
  const employeeId = searchParams.get("employeeId")

  const where: any = {
    tenantId: session.user.tenantId,
    periodYear,
    periodMonth,
  }
  if (employeeId) where.employeeId = employeeId

  const payments = await db.salaryPayment.findMany({
    where,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, role: true } },
      account: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  })

  return NextResponse.json(payments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Зарплатные выплаты доступны только владельцу и управляющему" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверка закрытия периода
  if (await isPeriodLocked(session.user.tenantId, new Date(Date.UTC(data.periodYear, data.periodMonth - 1, 1)), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.salaryPayment.create({
      data: {
        tenantId: session.user.tenantId,
        employeeId: data.employeeId,
        accountId: data.accountId,
        amount: data.amount,
        date: new Date(data.date),
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        periodHalf: data.periodHalf,
        comment: data.comment,
        createdBy: session.user.employeeId,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, role: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Списываем с баланса счёта
    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { decrement: data.amount } },
    })

    return p
  })

  logAudit({
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
    action: "create",
    entityType: "SalaryPayment",
    entityId: payment.id,
    changes: { amount: { new: data.amount }, employeeId: { new: data.employeeId }, periodYear: { new: data.periodYear }, periodMonth: { new: data.periodMonth } },
    req,
  })

  return NextResponse.json(payment, { status: 201 })
}
