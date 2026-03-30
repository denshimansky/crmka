import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

const templateItemSchema = z.object({
  dayOfWeek: z
    .number({ required_error: "Укажите день недели" })
    .min(0, "День недели от 0 до 6")
    .max(6, "День недели от 0 до 6"),
  startTime: z
    .string({ required_error: "Укажите время начала" })
    .regex(/^\d{2}:\d{2}$/, "Формат времени: ЧЧ:ММ")
    .transform((v) => v || null)
    .refine((v) => v !== null, "Укажите время начала"),
  durationMinutes: z
    .number({ required_error: "Укажите длительность" })
    .min(5, "Минимальная длительность 5 минут")
    .max(480, "Максимальная длительность 480 минут"),
})

const putSchema = z.object({
  templates: z.array(templateItemSchema).min(0),
})

// PUT /api/groups/[id]/templates — перезаписать шаблоны расписания
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Проверяем роль
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await request.json()
  const parsed = putSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // Проверяем что группа принадлежит организации
  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
  })

  if (!group) {
    return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  }

  // Удаляем все существующие шаблоны и создаём новые в транзакции
  const templates = await db.$transaction(async (tx) => {
    await tx.groupScheduleTemplate.deleteMany({
      where: { groupId: id, tenantId },
    })

    if (parsed.data.templates.length === 0) {
      return []
    }

    await tx.groupScheduleTemplate.createMany({
      data: parsed.data.templates.map((t) => ({
        tenantId,
        groupId: id,
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        effectiveFrom: new Date(),
      })),
    })

    return tx.groupScheduleTemplate.findMany({
      where: { groupId: id, tenantId },
      orderBy: { dayOfWeek: "asc" },
    })
  })

  return NextResponse.json({ templates })
}
