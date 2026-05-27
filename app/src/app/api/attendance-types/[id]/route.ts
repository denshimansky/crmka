import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  chargesSubscription: z.boolean().optional(),
  paysInstructor: z.boolean().optional(),
  countsAsRevenue: z.boolean().optional(),
  availableToInstructor: z.boolean().optional(),
  partOfPlan: z.boolean().optional(),
  partOfFact: z.boolean().optional(),
  partOfForecast: z.boolean().optional(),
  chargePercent: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// PATCH /api/attendance-types/[id] — обновить тип посещения
// Системные строки (tenantId=null): можно менять name/флаги/isActive/sortOrder, нельзя code.
// Кастомные: владелец/управляющий своего тенанта.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.attendanceType.findFirst({
    where: {
      id,
      OR: [{ tenantId: null }, { tenantId }],
    },
  })
  if (!existing) return NextResponse.json({ error: "Тип не найден" }, { status: 404 })

  if (existing.isFlagsLocked) {
    return NextResponse.json(
      { error: "Этот тип посещения нельзя редактировать — он зашит в бизнес-логику." },
      { status: 403 }
    )
  }

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.chargesSubscription !== undefined) data.chargesSubscription = parsed.data.chargesSubscription
  if (parsed.data.paysInstructor !== undefined) data.paysInstructor = parsed.data.paysInstructor
  if (parsed.data.countsAsRevenue !== undefined) data.countsAsRevenue = parsed.data.countsAsRevenue
  if (parsed.data.availableToInstructor !== undefined) data.availableToInstructor = parsed.data.availableToInstructor
  if (parsed.data.partOfPlan !== undefined) data.partOfPlan = parsed.data.partOfPlan
  if (parsed.data.partOfFact !== undefined) data.partOfFact = parsed.data.partOfFact
  if (parsed.data.partOfForecast !== undefined) data.partOfForecast = parsed.data.partOfForecast
  if (parsed.data.chargePercent !== undefined) data.chargePercent = parsed.data.chargePercent
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder

  const updated = await db.attendanceType.update({ where: { id }, data })
  return NextResponse.json(updated)
}

// DELETE /api/attendance-types/[id] — удалить кастомный тип
// Системные нельзя удалять (только деактивировать через PATCH isActive=false).
// Кастомный удаляется только если по нему нет ни одной Attendance — иначе 409.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.attendanceType.findFirst({ where: { id, tenantId } })
  if (!existing) {
    return NextResponse.json(
      { error: "Тип не найден или системный (системные нельзя удалить)" },
      { status: 404 }
    )
  }

  const usedCount = await db.attendance.count({ where: { attendanceTypeId: id } })
  if (usedCount > 0) {
    return NextResponse.json(
      {
        error: `По этому типу есть ${usedCount} ${usedCount === 1 ? "отметка" : "отметок"}. Деактивируйте тип вместо удаления.`,
      },
      { status: 409 }
    )
  }

  await db.attendanceType.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
