import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const closeSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  action: z.enum(["close", "reopen"]),
  comment: z.string().optional(),
})

// GET /api/periods — список периодов организации
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const periods = await db.period.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      closedByEmployee: { select: { firstName: true, lastName: true } },
      reopenedByEmployee: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  })

  return NextResponse.json(periods)
}

// POST /api/periods — закрыть или переоткрыть период
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Закрытие периода доступно только владельцу и управляющему" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = closeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const { year, month, action, comment } = parsed.data
  const tenantId = session.user.tenantId
  const employeeId = (session.user as any).employeeId

  const existing = await db.period.findUnique({
    where: { tenantId_year_month: { tenantId, year, month } },
  })

  if (action === "close") {
    if (existing?.status === "closed") {
      return NextResponse.json({ error: "Период уже закрыт" }, { status: 409 })
    }

    const period = await db.period.upsert({
      where: { tenantId_year_month: { tenantId, year, month } },
      create: {
        tenantId,
        year,
        month,
        status: "closed",
        closedAt: new Date(),
        closedBy: employeeId,
        comment,
      },
      update: {
        status: "closed",
        closedAt: new Date(),
        closedBy: employeeId,
        comment,
      },
    })

    return NextResponse.json(period, { status: 201 })
  }

  if (action === "reopen") {
    if (!existing || existing.status !== "closed") {
      return NextResponse.json({ error: "Период не закрыт" }, { status: 409 })
    }

    // Переоткрытие — только owner
    if (role !== "owner") {
      return NextResponse.json({ error: "Переоткрытие периода доступно только владельцу" }, { status: 403 })
    }

    const period = await db.period.update({
      where: { id: existing.id },
      data: {
        status: "reopened",
        reopenedAt: new Date(),
        reopenedBy: employeeId,
        comment,
      },
    })

    return NextResponse.json(period)
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
}
