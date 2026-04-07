import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  employeeId: z.string().uuid("Укажите сотрудника"),
  type: z.enum(["empty_group", "unmarked_lesson", "overdue_payment", "trial_reminder", "period_close", "linked_discount_warning"]),
  title: z.string().min(1, "Заголовок обязателен"),
  message: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get("unreadOnly")
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200)

  const where: any = {
    tenantId: session.user.tenantId,
    employeeId: session.user.employeeId,
  }

  if (unreadOnly === "true") where.isRead = false

  const [items, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.notification.count({ where }),
    db.notification.count({
      where: {
        tenantId: session.user.tenantId,
        employeeId: session.user.employeeId,
        isRead: false,
      },
    }),
  ])

  return NextResponse.json({ items, total, unreadCount, page, limit })
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

  const item = await db.notification.create({
    data: {
      tenantId: session.user.tenantId,
      employeeId: data.employeeId,
      type: data.type,
      title: data.title,
      message: data.message,
      entityType: data.entityType,
      entityId: data.entityId,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
