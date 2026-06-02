import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { rateLimitTenant } from "@/lib/rate-limit"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { payFromBalance, PayFromBalanceError } from "@/lib/subscriptions/pay-from-balance"
import { requirePermission } from "@/lib/api-permissions"
import { z } from "zod"
import { Prisma } from "@prisma/client"

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
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Ручное распределение поступившего платежа на N абонементов клиента.
  // Каждый элемент создаёт Payment type=transfer_in + transfer_to_subscription
  // ledger-запись через тот же сервис, что у кнопки «Оплатить».
  // Σ distribution[].amount должно быть ≤ amount; остаток остаётся на балансе.
  // Несовместимо с одиночным subscriptionId.
  distribution: z
    .array(
      z.object({
        subscriptionId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    )
    .optional(),
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

  // Проверяем абонемент если указан (только для платежей с клиентом).
  if (data.subscriptionId && data.clientId) {
    const sub = await db.subscription.findFirst({
      where: { id: data.subscriptionId, tenantId: session.user.tenantId, clientId: data.clientId, deletedAt: null },
    })
    if (!sub) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  }

  // Валидация distribution[]: только при платеже с клиентом, несовместимо с
  // одиночным subscriptionId, абонементы принадлежат тому же клиенту,
  // Σ amount ≤ total amount.
  if (data.distribution && data.distribution.length > 0) {
    if (!data.clientId) {
      return NextResponse.json(
        { error: "Распределение возможно только для платежа с клиентом" },
        { status: 400 },
      )
    }
    if (data.subscriptionId) {
      return NextResponse.json(
        { error: "Нельзя одновременно выбрать один абонемент и распределить на несколько" },
        { status: 400 },
      )
    }
    const distSum = data.distribution.reduce((s, d) => s + d.amount, 0)
    if (distSum > data.amount + 1e-6) {
      return NextResponse.json(
        { error: "Сумма распределения больше суммы платежа" },
        { status: 400 },
      )
    }
    const ids = data.distribution.map((d) => d.subscriptionId)
    const found = await db.subscription.findMany({
      where: {
        id: { in: ids },
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (found.length !== new Set(ids).size) {
      return NextResponse.json(
        { error: "Один из выбранных абонементов не найден или принадлежит другому клиенту" },
        { status: 400 },
      )
    }
  }

  // Первая ли оплата клиента?
  const priorPayments = data.clientId
    ? await db.payment.count({
        where: { clientId: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
      })
    : 0
  const isFirstPayment = !!data.clientId && priorPayments === 0

  // Создаём оплату и обновляем связанные сущности в транзакции
  let payment
  try {
    payment = await db.$transaction(async (tx) => {
    // Создаём оплату
    const p = await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        incomeCategoryId: data.incomeCategoryId,
        accountId: data.accountId,
        subscriptionId: data.clientId ? data.subscriptionId : undefined,
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

    // Обновляем баланс клиента через единый ledger
    await applyBalanceDelta(tx, {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      delta: data.amount,
      type: "payment_received",
      refs: { paymentId: p.id, subscriptionId: data.subscriptionId ?? null },
      createdBy: session.user.employeeId,
    })

    // Если привязан абонемент — уменьшаем остаток и активируем если pending
    if (data.subscriptionId) {
      const sub = await tx.subscription.findUnique({ where: { id: data.subscriptionId } })
      if (sub) {
        const updateSubData: any = {
          balance: { decrement: data.amount },
        }
        const becomesActive = sub.status === "pending"
        if (becomesActive) {
          updateSubData.status = "active"
          updateSubData.activatedAt = new Date()
        }
        await tx.subscription.update({
          where: { id: data.subscriptionId },
          data: updateSubData,
        })
        // Подопечный конкретного абонемента уходит из воронки продаж: подписка стала
        // активной, его место — в активной базе клиентов, а не в /crm/sales.
        if (becomesActive && sub.wardId) {
          await tx.ward.update({
            where: { id: sub.wardId },
            data: { salesStage: "none", salesStageAt: new Date() },
          })
          await tx.groupEnrollment.updateMany({
            where: {
              tenantId: session.user.tenantId,
              groupId: sub.groupId,
              clientId: data.clientId,
              wardId: sub.wardId,
              isActive: true,
            },
            data: { paymentStatus: "active" },
          })
        }
      }
    }

    // Ручное распределение поступления на абонементы (если задано админом).
    // Используем тот же сервис, что у кнопки «Оплатить»: создаёт по Payment
    // type=transfer_in на каждую позицию и пишет ledger через
    // applyBalanceDelta(transfer_to_subscription).
    let distributedAny = false
    if (data.distribution && data.distribution.length > 0 && data.clientId) {
      for (const item of data.distribution) {
        await payFromBalance(
          {
            tenantId: session.user.tenantId,
            subscriptionId: item.subscriptionId,
            amount: item.amount,
            createdBy: session.user.employeeId ?? null,
            comment: "Распределение поступления",
          },
          tx,
        )
        distributedAny = true
      }
    }
    if (distributedAny) {
      await tx.client.updateMany({
        where: {
          id: data.clientId,
          OR: [
            { clientStatus: { not: "active" } },
            { funnelStatus: { not: "active_client" } },
          ],
        },
        data: {
          clientStatus: "active",
          funnelStatus: "active_client",
        },
      })
    }

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
  } catch (e) {
    if (e instanceof PayFromBalanceError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus })
    }
    throw e
  }

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
