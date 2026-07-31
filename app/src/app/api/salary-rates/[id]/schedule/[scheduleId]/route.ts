import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { baseRateSchema, validateForScheme } from "@/lib/salary/rate-schema"

// Календарный UTC-день (для сравнения дат вступления «строго в будущем»).
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Правка версии: тот же ставочный блок + опциональная смена effectiveFrom.
const patchSchema = baseRateSchema.extend({
  effectiveFrom: z.string().optional(),
})

// PATCH /api/salary-rates/[id]/schedule/[scheduleId]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id, scheduleId } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRateSchedule.findFirst({
    where: { id: scheduleId, salaryRateId: id, tenantId, deletedAt: null },
    select: { id: true, effectiveFrom: true },
  })
  if (!existing) return NextResponse.json({ error: "Изменение не найдено" }, { status: 404 })

  const today = utcDay(new Date())
  if (utcDay(existing.effectiveFrom) <= today) {
    return NextResponse.json(
      { error: "Нельзя изменить уже наступившую версию ставки. Создайте новую версию с будущей даты или измените базовую ставку." },
      { status: 400 },
    )
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const validationError = validateForScheme(parsed.data)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  if (parsed.data.effectiveFrom) {
    const newDate = new Date(parsed.data.effectiveFrom)
    if (Number.isNaN(newDate.getTime())) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
    }
    if (utcDay(newDate) <= today) {
      return NextResponse.json({ error: "Дата вступления должна быть в будущем" }, { status: 400 })
    }
    const duplicate = await db.salaryRateSchedule.findFirst({
      where: { salaryRateId: id, tenantId, deletedAt: null, effectiveFrom: newDate, NOT: { id: scheduleId } },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: "Версия ставки на эту дату уже запланирована" }, { status: 409 })
    }
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.salaryRateSchedule.update({
      where: { id: scheduleId },
      data: {
        scheme: parsed.data.scheme,
        ratePerStudent: parsed.data.ratePerStudent ?? null,
        ratePerLesson: parsed.data.ratePerLesson ?? null,
        fixedPerShift: parsed.data.fixedPerShift ?? null,
        percentOfPayments: parsed.data.percentOfPayments ?? null,
        trialPayMode: parsed.data.trialPayMode ?? undefined,
        ...(parsed.data.effectiveFrom ? { effectiveFrom: new Date(parsed.data.effectiveFrom) } : {}),
      },
    })
    if (parsed.data.brackets !== undefined) {
      await tx.salaryBracket.deleteMany({ where: { salaryRateScheduleId: scheduleId } })
      if (parsed.data.brackets.length > 0) {
        await tx.salaryBracket.createMany({
          data: parsed.data.brackets.map((b) => ({
            tenantId,
            salaryRateScheduleId: scheduleId,
            minStudents: b.minStudents,
            ratePerLesson: b.ratePerLesson,
          })),
        })
      }
    }
    return tx.salaryRateSchedule.findUnique({
      where: { id: scheduleId },
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    })
  })

  return NextResponse.json(updated)
}

// DELETE /api/salary-rates/[id]/schedule/[scheduleId] — soft delete
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id, scheduleId } = await params
  const tenantId = session.user.tenantId

  const existing = await db.salaryRateSchedule.findFirst({
    where: { id: scheduleId, salaryRateId: id, tenantId, deletedAt: null },
    select: { id: true, effectiveFrom: true },
  })
  if (!existing) return NextResponse.json({ error: "Изменение не найдено" }, { status: 404 })

  if (utcDay(existing.effectiveFrom) <= utcDay(new Date())) {
    return NextResponse.json(
      { error: "Нельзя удалить уже наступившую версию ставки. Создайте новую версию с будущей даты или измените базовую ставку." },
      { status: 400 },
    )
  }

  await db.salaryRateSchedule.update({ where: { id: scheduleId }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
