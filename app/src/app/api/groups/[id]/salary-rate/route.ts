import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { bracketSchema, validateForScheme } from "@/lib/salary/rate-schema"
import { isGroupRateLocked } from "@/lib/salary/group-rate-lock"

// Для GroupSalaryRate directionId не нужен (один rate на группу — независимо от направления).
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
  // null = наследовать личную ставку инструктора для пробных этой группы.
  trialPayMode: z.enum(["none", "paid_only", "all"]).nullable().optional(),
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
// Если ставка группы задана — перебивает личные ставки всех инструкторов при расчёте ЗП.
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

  // Замок: в группе уже есть реальная отметка — ставку менять нельзя.
  if (await isGroupRateLocked(db, tenantId, id)) {
    return NextResponse.json(
      { error: "В группе уже есть отмеченные занятия — ставку группы менять нельзя" },
      { status: 409 },
    )
  }

  const body = await req.json()
  const parsed = groupRateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  // trialPayMode (null = наследовать) в проверку схемы не входит — нормализуем.
  const validationError = validateForScheme({
    ...parsed.data,
    trialPayMode: parsed.data.trialPayMode ?? undefined,
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const result = await db.$transaction(async (tx) => {
    // Повторная проверка замка ВНУТРИ транзакции (TOCTOU): между внешней проверкой
    // и записью могла появиться первая отметка — тогда ставку менять уже нельзя.
    if (await isGroupRateLocked(tx, tenantId, id)) return { locked: true as const }

    const existing = await tx.groupSalaryRate.findUnique({ where: { groupId: id } })
    const rateData = {
      scheme: parsed.data.scheme,
      ratePerStudent: parsed.data.ratePerStudent ?? null,
      ratePerLesson: parsed.data.ratePerLesson ?? null,
      fixedPerShift: parsed.data.fixedPerShift ?? null,
      percentOfPayments: parsed.data.percentOfPayments ?? null,
      trialPayMode: parsed.data.trialPayMode ?? null,
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

    const rate = await tx.groupSalaryRate.findUnique({
      where: { id: upserted.id },
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    })
    return { rate }
  })

  if ("locked" in result) {
    return NextResponse.json(
      { error: "В группе уже есть отмеченные занятия — ставку группы менять нельзя" },
      { status: 409 },
    )
  }
  return NextResponse.json(result.rate)
}

// DELETE /api/groups/[id]/salary-rate — снять ставку группы, вернуться к личным ставкам инструкторов.
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

  // Замок + снятие атомарно (TOCTOU): проверяем и удаляем в одной транзакции —
  // между проверкой и delete не должна проскочить первая отметка.
  const result = await db.$transaction(async (tx) => {
    if (await isGroupRateLocked(tx, tenantId, id)) return { locked: true as const }
    const existing = await tx.groupSalaryRate.findUnique({ where: { groupId: id } })
    if (!existing) return { removed: false }
    await tx.groupSalaryRate.delete({ where: { groupId: id } })
    return { removed: true }
  })

  if ("locked" in result) {
    return NextResponse.json(
      { error: "В группе уже есть отмеченные занятия — ставку группы менять нельзя" },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true, removed: result.removed })
}
