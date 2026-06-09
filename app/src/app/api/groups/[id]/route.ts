import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// startDate/endDate приходят как "YYYY-MM-DD" или null (снять дату).
// Если ключа нет в payload — поле не трогаем.
const dateOrNull = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
    z.null(),
  ])
  .optional()

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  directionId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
  maxStudents: z.number().min(1).optional(),
  isActive: z.boolean().optional(),
  archive: z.boolean().optional(),
  startDate: dateOrNull,
  endDate: dateOrNull,
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  // Позволяем получить и архивную группу (deletedAt != null) для просмотра
  const group = await db.group.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      direction: true,
      branch: true,
      room: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      templates: { orderBy: { dayOfWeek: "asc" } },
      enrollments: { where: { isActive: true }, include: { client: true, ward: true } },
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  return NextResponse.json(group)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.group.findFirst({ where: { id, tenantId: session.user.tenantId } })
  if (!existing) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const { archive, startDate, endDate, ...rest } = parsed.data

  // Архивирование: разрешено только если в группе нет активных детей и
  // нет открытых абонементов в эту группу. При архивации каскадом удаляем
  // будущие занятия (date >= today) — прошлые остаются в истории.
  if (archive === true) {
    const [activeEnrollments, openSubs] = await Promise.all([
      db.groupEnrollment.count({
        where: { groupId: id, tenantId: session.user.tenantId, isActive: true, deletedAt: null },
      }),
      db.subscription.count({
        where: {
          groupId: id,
          tenantId: session.user.tenantId,
          deletedAt: null,
          status: { in: ["pending", "active"] },
        },
      }),
    ])
    if (activeEnrollments > 0 || openSubs > 0) {
      const parts: string[] = []
      if (activeEnrollments > 0) parts.push(`в группе ${activeEnrollments} ребёнок/детей`)
      if (openSubs > 0) parts.push(`${openSubs} открытых абонементов`)
      return NextResponse.json(
        {
          error: `Сначала отчислите всех детей и закройте абонементы (${parts.join(", ")}).`,
        },
        { status: 400 },
      )
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const archived = await db.$transaction(async (tx) => {
      // Будущие занятия (без отметок) — отменяем. Если кто-то уже отметил
      // присутствие/отсутствие — занятие не трогаем, чтобы не потерять данные.
      // Lesson не имеет soft delete; используем status=cancelled (фильтр
      // расписания уже его исключает).
      await tx.lesson.updateMany({
        where: {
          groupId: id,
          tenantId: session.user.tenantId,
          date: { gte: today },
          status: "scheduled",
          attendances: { none: {} },
        },
        data: { status: "cancelled", cancelReason: "Группа архивирована" },
      })
      return tx.group.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
        include: {
          direction: true,
          room: true,
          instructor: { select: { firstName: true, lastName: true } },
        },
      })
    })
    return NextResponse.json(archived)
  }
  if (archive === false) {
    const group = await db.group.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
      include: { direction: true, room: true, instructor: { select: { firstName: true, lastName: true } } },
    })
    return NextResponse.json(group)
  }

  const updateData: Record<string, unknown> = { ...rest }
  if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null
  if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null

  const group = await db.group.update({
    where: { id },
    data: updateData,
    include: { direction: true, room: true, instructor: { select: { firstName: true, lastName: true } } },
  })

  // При изменении дат жизни группы перегенерируем расписание относительно
  // новых границ [startDate, endDate]: вне диапазона — удаляем занятия без
  // посещений (с посещениями — оставляем); внутри — чистим неактуальные
  // и догенерируем недостающие по шаблонам.
  if (startDate !== undefined || endDate !== undefined) {
    const { regenerateOnDateChange } = await import(
      "@/lib/schedule/generate-group-lessons"
    )
    const templates = await db.groupScheduleTemplate.findMany({
      where: { groupId: id, tenantId: session.user.tenantId },
    })
    await regenerateOnDateChange({
      tenantId: session.user.tenantId,
      groupId: id,
      instructorId: group.instructorId,
      templates: templates.map((t) => ({
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
      })),
      startDate: group.startDate,
      endDate: group.endDate,
    })
  }

  return NextResponse.json(group)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.group.findFirst({ where: { id, tenantId: session.user.tenantId } })
  if (!existing) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  await db.group.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
  return NextResponse.json({ ok: true })
}
