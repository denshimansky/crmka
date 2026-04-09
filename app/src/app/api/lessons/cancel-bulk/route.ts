import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты: YYYY-MM-DD"),
  branchId: z.string().uuid().optional(),
  reason: z.string().min(1, "Укажите причину отмены"),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = (session.user as any).tenantId
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 }
    )
  }

  const { date, branchId, reason } = parsed.data
  const targetDate = new Date(date + "T00:00:00.000Z")

  const where: any = {
    tenantId,
    date: targetDate,
    status: "scheduled",
  }
  if (branchId) {
    where.group = { branchId }
  }

  const result = await db.lesson.updateMany({
    where,
    data: {
      status: "cancelled",
      cancelReason: reason,
    },
  })

  return NextResponse.json({
    cancelled: result.count,
    date,
    reason,
  })
}
