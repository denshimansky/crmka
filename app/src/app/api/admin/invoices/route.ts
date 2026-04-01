import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
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

  // Генерируем номер счёта: INV-YYYYMM-XXX
  const now = new Date()
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`
  const count = await db.billingInvoice.count({
    where: { number: { startsWith: prefix } },
  })
  const number = `${prefix}-${String(count + 1).padStart(3, "0")}`

  const invoice = await db.billingInvoice.create({
    data: {
      subscriptionId: subscription.id,
      organizationId: subscription.organizationId,
      number,
      amount,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      dueDate: new Date(parsed.data.dueDate),
      comment: parsed.data.comment,
    },
    include: {
      organization: { select: { name: true } },
    },
  })

  return NextResponse.json(invoice, { status: 201 })
}
