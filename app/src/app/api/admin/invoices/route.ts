import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { nextInvoiceNumber } from "@/lib/billing/invoice-number"
import { z } from "zod"

// GET /api/admin/invoices — все счета
export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const status = searchParams.get("status")

  const where: Record<string, unknown> = {}
  if (organizationId) where.organizationId = organizationId
  if (status) where.status = status

  const invoices = await db.billingInvoice.findMany({
    where,
    include: {
      organization: { select: { id: true, name: true } },
      subscription: { select: { id: true, plan: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(invoices)
}

const createSchema = z.object({
  subscriptionId: z.string().uuid("Некорректный ID подписки"),
  periodStart: z.string({ required_error: "Начало периода обязательно" }),
  periodEnd: z.string({ required_error: "Конец периода обязателен" }),
  dueDate: z.string({ required_error: "Дата оплаты обязательна" }),
  amount: z.number().optional(), // авторасчёт если не указано
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// POST /api/admin/invoices — выставить счёт
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const subscription = await db.billingSubscription.findUnique({
    where: { id: parsed.data.subscriptionId },
  })
  if (!subscription) {
    return NextResponse.json({ error: "Подписка не найдена" }, { status: 404 })
  }

  const amount = parsed.data.amount ?? Number(subscription.monthlyAmount)
  const periodStart = new Date(parsed.data.periodStart)

  // Номер «{seq}-{MM}»: гонка по unique(number) разрешается ретраем
  let invoice = null
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const number = await nextInvoiceNumber(periodStart)
    try {
      invoice = await db.billingInvoice.create({
        data: {
          subscriptionId: subscription.id,
          organizationId: subscription.organizationId,
          number,
          amount,
          periodStart,
          periodEnd: new Date(parsed.data.periodEnd),
          dueDate: new Date(parsed.data.dueDate),
          comment: parsed.data.comment,
        },
        include: {
          organization: { select: { name: true } },
        },
      })
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e
    }
  }
  if (!invoice) {
    return NextResponse.json({ error: "Не удалось сгенерировать номер счёта" }, { status: 500 })
  }

  return NextResponse.json(invoice, { status: 201 })
}
