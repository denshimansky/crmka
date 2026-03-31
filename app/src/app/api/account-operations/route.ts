import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  type: z.enum(["owner_withdrawal", "encashment", "transfer"], {
    errorMap: () => ({ message: "Выберите тип операции" }),
  }),
  fromAccountId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  toAccountId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  date: z.string().min(1, "Укажите дату"),
  description: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")

  const where: any = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  if (dateFrom || dateTo) {
    where.date = {}
    if (dateFrom) where.date.gte = new Date(dateFrom)
    if (dateTo) where.date.lte = new Date(dateTo)
  }

  const operations = await db.accountOperation.findMany({
    where,
    include: {
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  })

  return NextResponse.json(operations)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Валидация по типу
  if (data.type === "transfer") {
    if (!data.fromAccountId || !data.toAccountId) {
      return NextResponse.json({ error: "Укажите счёт-источник и счёт-получатель" }, { status: 400 })
    }
    if (data.fromAccountId === data.toAccountId) {
      return NextResponse.json({ error: "Счёт-источник и получатель не могут совпадать" }, { status: 400 })
    }
  } else if (data.type === "owner_withdrawal" || data.type === "encashment") {
    if (!data.fromAccountId) {
      return NextResponse.json({ error: "Укажите счёт списания" }, { status: 400 })
    }
  }

  const operation = await db.$transaction(async (tx) => {
    const op = await tx.accountOperation.create({
      data: {
        tenantId: session.user.tenantId,
        type: data.type,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amount: data.amount,
        date: new Date(data.date),
        description: data.description,
        createdBy: session.user.employeeId,
      },
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
      },
    })

    // Обновляем балансы
    if (data.fromAccountId) {
      await tx.financialAccount.update({
        where: { id: data.fromAccountId },
        data: { balance: { decrement: data.amount } },
      })
    }
    if (data.toAccountId) {
      await tx.financialAccount.update({
        where: { id: data.toAccountId },
        data: { balance: { increment: data.amount } },
      })
    }

    return op
  })

  return NextResponse.json(operation, { status: 201 })
}
