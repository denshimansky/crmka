import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  subscriptionId: z.string().uuid("Укажите абонемент"),
  comment: z.string().min(1, "Комментарий обязателен"),
})

// Комментарий к непродлённому абонементу клиента (с карточки). period* берём из
// самого абонемента, чтобы клиенту не нужно было их слать.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { subscriptionId, comment } = parsed.data

  // Абонемент должен принадлежать этому клиенту и арендатору.
  const sub = await db.subscription.findFirst({
    where: { id: subscriptionId, clientId: id, tenantId, deletedAt: null },
    select: { id: true, periodYear: true, periodMonth: true, expiresAt: true, startDate: true },
  })
  if (!sub) return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 })

  // Период: из абонемента (calendar), иначе выводим из expiresAt/startDate (package).
  const fallback = sub.expiresAt ?? sub.startDate
  const periodYear = sub.periodYear ?? fallback.getUTCFullYear()
  const periodMonth = sub.periodMonth ?? fallback.getUTCMonth() + 1

  const item = await db.unprolongedComment.create({
    data: {
      tenantId,
      clientId: id,
      subscriptionId,
      periodYear,
      periodMonth,
      comment: comment.trim(),
      createdBy: session.user.employeeId,
    },
    select: {
      id: true,
      subscriptionId: true,
      comment: true,
      createdAt: true,
      creator: { select: { firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(
    {
      id: item.id,
      subscriptionId: item.subscriptionId,
      comment: item.comment,
      authorName: [item.creator?.lastName, item.creator?.firstName].filter(Boolean).join(" ") || "—",
      createdAt: item.createdAt.toISOString(),
    },
    { status: 201 },
  )
}
