import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { validateForScheme } from "@/app/api/employees/[id]/salary-rates/route"

const bracketSchema = z.object({
  minStudents: z.number().int().min(1).max(50),
  ratePerLesson: z.number().min(0),
})

const groupRateSchema = z.object({
  scheme: z.enum([
    "per_student",
    "per_lesson",
    "fixed_plus_per_student",
    "percent_of_payments",
    "floating_by_students",
  ]),
  ratePerStudent: z.number().min(0).nullable().optional(),
  ratePerLesson: z.number().min(0).nullable().optional(),
  fixedPerShift: z.number().min(0).nullable().optional(),
  percentOfPayments: z.number().min(0).max(100).nullable().optional(),
  brackets: z.array(bracketSchema).optional(),
})

// GET /api/groups/[id]/salary-rate — ставка группы (или null если не задана)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const rate = await db.groupSalaryRate.findUnique({
    where: { groupId: id },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })

  return NextResponse.json(rate)
}

// PUT /api/groups/[id]/salary-rate — upsert: создать или обновить ставку группы.
// Если ставка группы задана — перебивает личные ставки всех педагогов при расчёте ЗП.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const body = await req.json()
  const parsed = groupRateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.groupSalaryRate.findUnique({ where: { groupId: id } })
    const rateData = {
      scheme: parsed.data.scheme,
      ratePerStudent: parsed.data.ratePerStudent ?? null,
      ratePerLesson: parsed.data.ratePerLesson ?? null,
      fixedPerShift: parsed.data.fixedPerShift ?? null,
      percentOfPayments: parsed.data.percentOfPayments ?? null,
    }
    const upserted = existing
      ? await tx.groupSalaryRate.update({ where: { groupId: id }, data: rateData })
      : await tx.groupSalaryRate.create({ data: { tenantId, groupId: id, ...rateData } })

    if (parsed.data.brackets !== undefined) {
      await tx.salaryBracket.deleteMany({ where: { groupSalaryRateId: upserted.id } })
      if (parsed.data.brackets.length > 0) {
        await tx.salaryBracket.createMany({
          data: parsed.data.brackets.map((b) => ({
            tenantId,
            groupSalaryRateId: upserted.id,
            minStudents: b.minStudents,
            ratePerLesson: b.ratePerLesson,
          })),
        })
      }
    }

    return tx.groupSalaryRate.findUnique({
      where: { id: upserted.id },
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    })
  })

  return NextResponse.json(result)
}

// DELETE /api/groups/[id]/salary-rate — снять ставку группы, вернуться к личным ставкам педагогов.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const existing = await db.groupSalaryRate.findUnique({ where: { groupId: id } })
  if (!existing) return NextResponse.json({ ok: true, removed: false })

  await db.groupSalaryRate.delete({ where: { groupId: id } })
  return NextResponse.json({ ok: true, removed: true })
}
