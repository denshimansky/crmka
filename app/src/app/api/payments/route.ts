import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const createSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  accountId: z.string().uuid("Некорректный ID счёта"),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  method: z.enum(["cash", "bank_transfer", "acquiring", "online_yukassa", "online_robokassa", "sbp_qr"], {
    errorMap: () => ({ message: "Выберите способ оплаты" }),
  }),
  date: z.string().min(1, "Укажите дату"),
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

  // Проверяем абонемент если указан
  if (data.subscriptionId) {
    const sub = await db.subscription.findFirst({
      where: { id: data.subscriptionId, tenantId: session.user.tenantId, clientId: data.clientId, deletedAt: null },
    })
    if (!sub) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })
  }

  // Первая ли оплата клиента?
  const priorPayments = await db.payment.count({
    where: { clientId: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
  })
  const isFirstPayment = priorPayments === 0

  // Создаём оплату и обновляем связанные сущности в транзакции
  const payment = await db.$transaction(async (tx) => {
    // Создаём оплату
    const p = await tx.payment.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        accountId: data.accountId,
        subscriptionId: data.subscriptionId,
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

    // Обновляем баланс клиента
    await tx.client.update({
      where: { id: data.clientId },
      data: { clientBalance: { increment: data.amount } },
    })

    // Если привязан абонемент — уменьшаем остаток и активируем если pending
    if (data.subscriptionId) {
      const sub = await tx.subscription.findUnique({ where: { id: data.subscriptionId } })
      if (sub) {
        const updateSubData: any = {
          balance: { decrement: data.amount },
        }
        if (sub.status === "pending") {
          updateSubData.status = "active"
          updateSubData.activatedAt = new Date()
        }
        await tx.subscription.update({
          where: { id: data.subscriptionId },
          data: updateSubData,
        })
      }
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

  return NextResponse.json(payment, { status: 201 })
}
