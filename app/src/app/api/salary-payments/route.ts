import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/api-permissions"

// Legacy: одна выплата = (employee × account × amount). Используется простым диалогом
// «Провести выплату». Сохраняется как SalaryPayment + одна позиция SalaryPaymentItem
// (directionId = null) для согласованности с новым flow.
const legacySchema = z.object({
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

// Document: одна выплата = N позиций (сотрудник × счёт × направление × сумма).
// Используется страницей /salary/payments/new с кнопкой «Заполнить».
const docSchema = z.object({
  date: z.string().min(1, "Укажите дату"),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  periodHalf: z.any().transform(v => {
    const n = Number(v)
    return n === 1 || n === 2 ? n : undefined
  }),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  items: z.array(z.object({
    employeeId: z.string().uuid(),
    accountId: z.string().uuid(),
    directionId: z.string().uuid().nullable().optional(),
    amount: z.number().min(0.01),
    comment: z.string().optional().nullable(),
  })).default([]),
  // Премия/депремирование, создаются как SalaryAdjustment в той же транзакции,
  // что и выплата (атомарно). Премию клиент дополнительно кладёт в items
  // (выплачивается сейчас); штраф — только начисление (уменьшает «Осталось»),
  // в items НЕ попадает.
  adjustments: z.array(z.object({
    employeeId: z.string().uuid(),
    type: z.enum(["bonus", "penalty"]),
    amount: z.number().min(0.01),
    comment: z.string().min(1, "Комментарий к премии/штрафу обязателен"),
  })).default([]),
}).refine((d) => d.items.length > 0 || d.adjustments.length > 0, {
  message: "Добавьте строку выплаты или премию/штраф",
  path: ["items"],
})

export async function GET(req: NextRequest) {
  const guard = await requirePermission("finance.salary")
  if (!guard.ok) return guard.response
  const session = guard.session

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
      items: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          account: { select: { id: true, name: true } },
          direction: { select: { id: true, name: true } },
        },
      },
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
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  // === Документ с items / премиями-штрафами ===
  if (Array.isArray(body?.items) || Array.isArray(body?.adjustments)) {
    const parsed = docSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
    }
    const data = parsed.data

    if (await isPeriodLocked(tenantId, new Date(Date.UTC(data.periodYear, data.periodMonth - 1, 1)), role)) {
      return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
    }

    // Проверяем сотрудников/счета/направления одним прогоном. employeeId берём и
    // из выплат (items), и из премий/штрафов (adjustments) — премия/штраф могут
    // идти без выплаты.
    const employeeIds = Array.from(new Set([
      ...data.items.map(i => i.employeeId),
      ...data.adjustments.map(a => a.employeeId),
    ]))
    const accountIds = Array.from(new Set(data.items.map(i => i.accountId)))
    const directionIds = Array.from(new Set(data.items.map(i => i.directionId).filter((v): v is string => !!v)))

    const [employees, accounts, directions] = await Promise.all([
      db.employee.findMany({ where: { id: { in: employeeIds }, tenantId }, select: { id: true } }),
      accountIds.length > 0
        ? db.financialAccount.findMany({ where: { id: { in: accountIds }, tenantId }, select: { id: true } })
        : Promise.resolve([] as Array<{ id: string }>),
      directionIds.length > 0
        ? db.direction.findMany({ where: { id: { in: directionIds }, tenantId }, select: { id: true } })
        : Promise.resolve([] as Array<{ id: string }>),
    ])
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ error: "Один или несколько сотрудников не найдены" }, { status: 404 })
    }
    if (accounts.length !== accountIds.length) {
      return NextResponse.json({ error: "Один или несколько счетов не найдены" }, { status: 404 })
    }
    if (directions.length !== directionIds.length) {
      return NextResponse.json({ error: "Одно или несколько направлений не найдены" }, { status: 404 })
    }

    const totalAmount = data.items.reduce((s, it) => s + it.amount, 0)

    const payment = await db.$transaction(async (tx) => {
      let p: { id: string } | null = null

      // Выплата (может отсутствовать, если проводят только премию/штраф).
      if (data.items.length > 0) {
        // Шапка документа. employeeId/accountId/amount — репрезентативные (для обратной
        // совместимости со старыми выборками). Источник истины — items.
        const created = await tx.salaryPayment.create({
          data: {
            tenantId,
            employeeId: data.items[0].employeeId,
            accountId: data.items[0].accountId,
            amount: totalAmount,
            date: new Date(data.date),
            periodYear: data.periodYear,
            periodMonth: data.periodMonth,
            periodHalf: data.periodHalf,
            comment: data.comment,
            createdBy: employeeId,
          },
        })
        p = created

        await tx.salaryPaymentItem.createMany({
          data: data.items.map((it) => ({
            tenantId,
            salaryPaymentId: created.id,
            employeeId: it.employeeId,
            accountId: it.accountId,
            directionId: it.directionId ?? null,
            amount: it.amount,
            comment: it.comment ?? null,
          })),
        })

        // Списываем суммы со счетов (агрегируем по счёту, чтобы не дёргать update N раз).
        const byAccount = new Map<string, number>()
        for (const it of data.items) {
          byAccount.set(it.accountId, (byAccount.get(it.accountId) || 0) + it.amount)
        }
        for (const [accId, sum] of byAccount.entries()) {
          await tx.financialAccount.update({ where: { id: accId }, data: { balance: { decrement: sum } } })
        }
      }

      // Премии/штрафы за период (атомарно с выплатой).
      if (data.adjustments.length > 0) {
        await tx.salaryAdjustment.createMany({
          data: data.adjustments.map((a) => ({
            tenantId,
            employeeId: a.employeeId,
            type: a.type,
            amount: a.amount,
            periodYear: data.periodYear,
            periodMonth: data.periodMonth,
            comment: a.comment,
            createdBy: employeeId,
          })),
        })
      }

      return p
    })

    logAudit({
      tenantId,
      employeeId,
      action: "create",
      entityType: "SalaryPayment",
      entityId: payment?.id ?? "adjustments-only",
      changes: {
        amount: { new: totalAmount },
        items: { new: data.items.length },
        adjustments: { new: data.adjustments.length },
        periodYear: { new: data.periodYear },
        periodMonth: { new: data.periodMonth },
      },
      req,
    })

    return NextResponse.json(payment ?? { ok: true, adjustments: data.adjustments.length }, { status: 201 })
  }

  // === Legacy: одна выплата ===
  const parsed = legacySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const [employee, account] = await Promise.all([
    db.employee.findFirst({ where: { id: data.employeeId, tenantId }, select: { id: true } }),
    db.financialAccount.findFirst({ where: { id: data.accountId, tenantId }, select: { id: true } }),
  ])
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  if (await isPeriodLocked(tenantId, new Date(Date.UTC(data.periodYear, data.periodMonth - 1, 1)), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.salaryPayment.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        accountId: data.accountId,
        amount: data.amount,
        date: new Date(data.date),
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        periodHalf: data.periodHalf,
        comment: data.comment,
        createdBy: employeeId,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, role: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Зеркальная позиция в items — чтобы новый журнал ДДС и ОПИУ видели одну и ту же
    // запись независимо от того, через какой UI создана выплата.
    await tx.salaryPaymentItem.create({
      data: {
        tenantId,
        salaryPaymentId: p.id,
        employeeId: data.employeeId,
        accountId: data.accountId,
        directionId: null,
        amount: data.amount,
        comment: data.comment ?? null,
      },
    })

    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { decrement: data.amount } },
    })

    return p
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "SalaryPayment",
    entityId: payment.id,
    changes: { amount: { new: data.amount }, employeeId: { new: data.employeeId }, periodYear: { new: data.periodYear }, periodMonth: { new: data.periodMonth } },
    req,
  })

  return NextResponse.json(payment, { status: 201 })
}
