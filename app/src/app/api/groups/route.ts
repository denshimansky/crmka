import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

// GET /api/groups — список групп организации
export async function GET() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null },
    include: {
      direction: true,
      branch: true,
      room: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      templates: { orderBy: { dayOfWeek: "asc" } },
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(groups)
}

// POST /api/groups — создать группу
const templateSchema = z.object({
  dayOfWeek: z.number().min(0).max(6, "День недели от 0 (Пн) до 6 (Вс)"),
  startTime: z
    .string()
    .min(1, "Укажите время начала")
    .regex(/^\d{2}:\d{2}$/, "Формат времени: HH:MM"),
  durationMinutes: z.number().min(1, "Длительность должна быть больше 0"),
})

const createGroupSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Укажите название группы")),
  directionId: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Выберите направление")),
  branchId: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Выберите филиал")),
  roomId: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Выберите кабинет")),
  instructorId: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Выберите инструктора")),
  maxStudents: z.number().min(1, "Минимум 1 ученик").default(15),
  templates: z.array(templateSchema).optional(),
})

export async function POST(request: NextRequest) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const body = await request.json()
  const parsed = createGroupSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { templates, ...data } = parsed.data

  const group = await db.group.create({
    data: {
      ...data,
      tenantId,
      templates: templates?.length
        ? {
            create: templates.map((t) => ({
              tenantId,
              dayOfWeek: t.dayOfWeek,
              startTime: t.startTime,
              durationMinutes: t.durationMinutes,
              effectiveFrom: new Date(),
            })),
          }
        : undefined,
    },
    include: {
      direction: true,
      branch: true,
      room: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      templates: true,
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
  })

  return NextResponse.json(group, { status: 201 })
}
