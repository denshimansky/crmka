import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const bracketSchema = z.object({
  minStudents: z.number().int().min(1).max(50),
  ratePerLesson: z.number().min(0),
})

const baseRateSchema = z.object({
  scheme: z.enum([
    "per_student",
    "per_lesson",
    "fixed_plus_per_student",
    "percent_of_payments",
    "floating_by_students",
  ]),
  directionId: z.string().uuid().nullable().optional(),
  ratePerStudent: z.number().min(0).nullable().optional(),
  ratePerLesson: z.number().min(0).nullable().optional(),
  fixedPerShift: z.number().min(0).nullable().optional(),
  percentOfPayments: z.number().min(0).max(100).nullable().optional(),
  brackets: z.array(bracketSchema).optional(),
})

// Проверка консистентности: для каждой схемы — обязательные поля.
function validateForScheme(data: z.infer<typeof baseRateSchema>): string | null {
  switch (data.scheme) {
    case "per_student":
      if (!data.ratePerStudent || data.ratePerStudent <= 0) return "Укажите ставку за ученика"
      return null
    case "per_lesson":
      if (!data.ratePerLesson || data.ratePerLesson <= 0) return "Укажите ставку за занятие"
      return null
    case "fixed_plus_per_student":
      if (!data.ratePerStudent || data.ratePerStudent <= 0) return "Укажите ставку за ученика"
      if (!data.fixedPerShift || data.fixedPerShift <= 0) return "Укажите фикс за выход"
      return null
    case "percent_of_payments":
      if (!data.percentOfPayments || data.percentOfPayments <= 0) return "Укажите процент списания"
      return null
    case "floating_by_students":
      if (!data.brackets || data.brackets.length === 0) return "Добавьте хотя бы одну строку матрицы"
      return null
  }
}

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

export { baseRateSchema, validateForScheme }
