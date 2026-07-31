import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { scheduleCreateSchema, validateForScheme } from "@/lib/salary/rate-schema"

// GET /api/salary-rates/[id]/schedule — версии ставки [id] (не удалённые, по дате)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const rate = await db.salaryRate.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const schedules = await db.salaryRateSchedule.findMany({
    where: { salaryRateId: id, tenantId, deletedAt: null },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
    orderBy: { effectiveFrom: "asc" },
  })
  return NextResponse.json(schedules)
}

// POST /api/salary-rates/[id]/schedule — запланировать изменение ставки с даты
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const rate = await db.salaryRate.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const body = await req.json()
  const parsed = scheduleCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const effectiveFrom = new Date(parsed.data.effectiveFrom)
  const duplicate = await db.salaryRateSchedule.findFirst({
    where: { salaryRateId: id, tenantId, deletedAt: null, effectiveFrom },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json({ error: "Версия ставки на эту дату уже запланирована" }, { status: 409 })
  }

  const createdBy = (session.user as { employeeId?: string | null }).employeeId ?? null

  const created = await db.salaryRateSchedule.create({
    data: {
      tenantId,
      salaryRateId: id,
      effectiveFrom,
      scheme: parsed.data.scheme,
      ratePerStudent: parsed.data.ratePerStudent ?? null,
      ratePerLesson: parsed.data.ratePerLesson ?? null,
      fixedPerShift: parsed.data.fixedPerShift ?? null,
      percentOfPayments: parsed.data.percentOfPayments ?? null,
      trialPayMode: parsed.data.trialPayMode ?? "none",
      createdBy,
      brackets: parsed.data.brackets
        ? {
            create: parsed.data.brackets.map((b) => ({
              tenantId,
              minStudents: b.minStudents,
              ratePerLesson: b.ratePerLesson,
            })),
          }
        : undefined,
    },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })

  return NextResponse.json(created, { status: 201 })
}
