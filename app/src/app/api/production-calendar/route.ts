import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  date: z.string().min(1, "Укажите дату"),
  isWorking: z.boolean(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year")
  const month = searchParams.get("month")

  const where: any = {
    tenantId: session.user.tenantId,
  }

  if (year) {
    const y = parseInt(year, 10)
    const m = month ? parseInt(month, 10) : null
    const startDate = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1)
    const endDate = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1)
    where.date = { gte: startDate, lt: endDate }
  }

  const items = await db.productionCalendar.findMany({
    where,
    orderBy: { date: "asc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const item = await db.productionCalendar.upsert({
    where: {
      tenantId_date: {
        tenantId: session.user.tenantId,
        date: new Date(data.date),
      },
    },
    update: {
      isWorking: data.isWorking,
      comment: data.comment,
    },
    create: {
      tenantId: session.user.tenantId,
      date: new Date(data.date),
      isWorking: data.isWorking,
      comment: data.comment,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
