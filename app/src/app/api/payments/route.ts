import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { rateLimitTenant } from "@/lib/rate-limit"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { requirePermission } from "@/lib/api-permissions"
import { z } from "zod"
import { Prisma } from "@prisma/client"

// Поступление денег от клиента всегда падает только на баланс родителя.
// Списание в счёт конкретного абонемента — отдельная операция через кнопку
// «Оплатить с баланса» в карточке абонемента (POST /api/subscriptions/[id]/pay-from-balance).
const createSchema = z.object({
  // Для обычной оплаты от клиента — clientId. Для прочих доходов (проценты банка,
  // продажа товаров) — incomeCategoryId. Хотя бы одно из них обязательно.
  clientId: z.string().uuid("Некорректный ID клиента").optional(),
  incomeCategoryId: z.string().uuid("Некорректный ID категории дохода").optional(),
  accountId: z.string().uuid("Некорректный ID счёта"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  method: z.enum(["cash", "bank_transfer", "acquiring", "online_yukassa", "online_robokassa", "sbp_qr"], {
    errorMap: () => ({ message: "Выберите способ оплаты" }),
  }),
  date: z.string().min(1, "Укажите дату"),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const guard = await requirePermission("finance.view")
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")
  const method = searchParams.get("method")

  const where: Prisma.PaymentWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  if (clientId) where.clientId = clientId
  if (method) where.method = method as any

  if (dateFrom || dateTo) {
    where.date = {}
    if (dateFrom) (where.date as any).gte = new Date(dateFrom)
    if (dateTo) (where.date as any).lte = new Date(dateTo)
  }

  const payments = await db.payment.findMany({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      subscription: {
        select: {
          id: true,
          periodYear: true,
          periodMonth: true,
          direction: { select: { name: true } },
        },
      },
      account: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  })

  return NextResponse.json(payments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Tenant rate limiting (L-1 audit fix)
  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })

  const role = (session.user as any).role
  if (role === "readonly" || role === "instructor") {
    return NextResponse.json({ error: "Недостаточно прав для создания оплат" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверка закрытия периода
  if (await isPeriodLocked(session.user.tenantId, new Date(data.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Должно быть либо clientId, либо incomeCategoryId (прочий доход).
  const isOtherIncome = !data.clientId && !!data.incomeCategoryId
  if (!data.clientId && !data.incomeCategoryId) {
    return NextResponse.json({ error: "Укажите клиента или категорию дохода" }, { status: 400 })
  }
  if (data.clientId && data.incomeCategoryId) {
    return NextResponse.json({ error: "Нельзя указать одновременно клиента и категорию прочего дохода" }, { status: 400 })
  }

  // Проверяем клиента, если он передан.
  let client: { id: string } | null = null
  if (data.clientId) {
    client = await db.client.findFirst({
      where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
      select: { id: true },
    })
    if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  }

  // Проверяем категорию дохода (если прочий доход).
  if (isOtherIncome && data.incomeCategoryId) {
    const cat = await db.incomeCategory.findFirst({
      where: {
        id: data.incomeCategoryId,
        OR: [{ tenantId: null }, { tenantId: session.user.tenantId }],
        isActive: true,
      },
    })
    if (!cat) return NextResponse.json({ error: "Категория дохода не найдена" }, { status: 404 })
  }

  // Проверяем счёт
  const account = await db.financialAccount.findFirst({
    where: { id: data.accountId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  // Первая ли оплата клиента?
  const priorPayments = data.clientId
    ? await db.payment.count({
        where: { clientId: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
      })
    : 0
  const isFirstPayment = !!data.clientId && priorPayments === 0

  // Создаём оплату и обновляем связанные сущности в транзакции
  const payment = await db.$transaction(async (tx) => {
    // Создаём оплату (subscriptionId всегда null — привязка к абонементу
    // делается отдельной операцией через POST /api/subscriptions/[id]/pay-from-balance).
    const p = await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        incomeCategoryId: data.incomeCategoryId,
        accountId: data.accountId,
        amount: data.amount,
        type: "incoming",
        method: data.method,
        date: new Date(data.date),
        comment: data.comment,
        isFirstPayment,
        createdBy: session.user.employeeId,
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        account: { select: { id: true, name: true } },
      },
    })

    // Обновляем баланс счёта
    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { increment: data.amount } },
    })

    // Для прочих доходов (без клиента) — никаких баланс-клиента, абонементов,
    // воронок: только запись Payment и баланс счёта.
    if (!data.clientId) {
      return p
    }

    // Обновляем баланс родителя через единый ledger. Деньги ложатся на
    // clientBalance; распределение по абонементам — отдельная операция.
    await applyBalanceDelta(tx, {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      delta: data.amount,
      type: "payment_received",
      refs: { paymentId: p.id, subscriptionId: null },
      createdBy: session.user.employeeId,
    })

    // Если первая оплата — переводим клиента в active_client
    if (isFirstPayment) {
      await tx.client.update({
        where: { id: data.clientId },
        data: {
          funnelStatus: "active_client",
          clientStatus: "active",
          firstPaymentDate: new Date(data.date),
          saleDate: new Date(data.date),
        },
      })
    }

    return p
  })

  // Аудит (после транзакции, не блокирует)
  logAudit({
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
    action: "create",
    entityType: "Payment",
    entityId: payment.id,
    changes: {
      amount: { new: data.amount },
      method: { new: data.method },
      clientId: { new: data.clientId ?? null },
      incomeCategoryId: { new: data.incomeCategoryId ?? null },
    },
    req,
  })

  // Каскад: после оплаты клиента убираем уведомления о просроченной оплате.
  // Для прочих доходов (без клиента) этого каскада нет.
  if (data.clientId) {
    await db.notification.deleteMany({
      where: {
        tenantId: session.user.tenantId,
        type: "overdue_payment",
        entityType: "Client",
        entityId: data.clientId,
      },
    })
  }

  return NextResponse.json(payment, { status: 201 })
}
