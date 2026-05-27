import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { baseRateSchema, validateForScheme } from "@/lib/salary/rate-schema"

// GET /api/employees/[id]/salary-rates — список ставок инструктора
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const employee = await db.employee.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  const rates = await db.salaryRate.findMany({
    where: { tenantId, employeeId: id },
    include: {
      direction: { select: { id: true, name: true } },
      brackets: { orderBy: { minStudents: "asc" } },
    },
    orderBy: [{ directionId: "asc" }],
  })

  return NextResponse.json(rates)
}

// POST /api/employees/[id]/salary-rates — создать ставку (дефолтную или по направлению)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const employee = await db.employee.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  const body = await req.json()
  const parsed = baseRateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const validationError = validateForScheme(parsed.data)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const directionId = parsed.data.directionId || null

  // Проверка дубликата (одна запись на пару employee+direction)
  const existing = await db.salaryRate.findFirst({
    where: { tenantId, employeeId: id, directionId },
  })
  if (existing) {
    return NextResponse.json(
      { error: directionId ? "Исключение по этому направлению уже существует" : "Дефолтная ставка уже задана" },
      { status: 409 }
    )
  }

  const created = await db.salaryRate.create({
    data: {
      tenantId,
      employeeId: id,
      directionId,
      scheme: parsed.data.scheme,
      ratePerStudent: parsed.data.ratePerStudent ?? null,
      ratePerLesson: parsed.data.ratePerLesson ?? null,
      fixedPerShift: parsed.data.fixedPerShift ?? null,
      percentOfPayments: parsed.data.percentOfPayments ?? null,
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
    include: {
      direction: { select: { id: true, name: true } },
      brackets: { orderBy: { minStudents: "asc" } },
    },
  })

  return NextResponse.json(created, { status: 201 })
}

