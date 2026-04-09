import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { logAudit } from "@/lib/audit"
import { rateLimitTenant } from "@/lib/rate-limit"
import { z } from "zod"

const refundSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  accountId: z.string().uuid("Некорректный ID счёта"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  method: z.enum(["cash", "bank_transfer", "acquiring", "online_yukassa", "online_robokassa", "sbp_qr"], {
    errorMap: () => ({ message: "Выберите способ возврата" }),
  }),
  date: z.string().min(1, "Укажите дату"),
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Tenant rate limiting
  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })

  const role = (session.user as any).role
  if (role === "readonly" || role === "instructor") {
    return NextResponse.json({ error: "Недостаточно прав для оформления возвратов" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = refundSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверка закрытия периода
  if (await isPeriodLocked(session.user.tenantId, new Date(data.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Проверяем клиента
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Проверяем счёт
  const account = await db.financialAccount.findFirst({
    where: { id: data.accountId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!account) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 })

  // Проверяем достаточность средств на счёте
  if (Number(account.balance) < data.amount) {
    return NextResponse.json({
      error: `Недостаточно средств на счёте «${account.name}». Баланс: ${Number(account.balance).toFixed(2)} ₽, возврат: ${data.amount.toFixed(2)} ₽`,
    }, { status: 400 })
  }

  // Проверяем абонемент если указан
  if (data.subscriptionId) {
    const sub = await db.subscription.findFirst({
      where: { id: data.subscriptionId, tenantId: session.user.tenantId, clientId: data.clientId, deletedAt: null },
    })
    if (!sub) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  }

  // Создаём возврат в транзакции
  const payment = await db.$transaction(async (tx) => {
    // Создаём оплату с типом refund и отрицательной суммой
    const p = await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        accountId: data.accountId,
        subscriptionId: data.subscriptionId,
        amount: -data.amount,
        type: "refund",
        method: data.method,
        date: new Date(data.date),
        comment: data.comment || "Возврат средств",
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

    // Уменьшаем баланс счёта
    await tx.financialAccount.update({
      where: { id: data.accountId },
      data: { balance: { decrement: data.amount } },
    })

    // Уменьшаем баланс клиента
    await tx.client.update({
      where: { id: data.clientId },
      data: { clientBalance: { decrement: data.amount } },
    })

    // Если привязан абонемент — увеличиваем остаток (обратная операция от оплаты)
    if (data.subscriptionId) {
      await tx.subscription.update({
        where: { id: data.subscriptionId },
        data: { balance: { increment: data.amount } },
      })
    }

    return p
  })

  // Аудит
  logAudit({
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
    action: "create",
    entityType: "Payment",
    entityId: payment.id,
    changes: { type: { new: "refund" }, amount: { new: -data.amount }, method: { new: data.method }, clientId: { new: data.clientId } },
    req,
  })

  return NextResponse.json(payment, { status: 201 })
}
