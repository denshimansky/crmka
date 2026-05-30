import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import {
  generateGroupLessons,
  getGenerationRange,
} from "@/lib/schedule/generate-group-lessons"
import { bracketSchema, validateForScheme } from "@/lib/salary/rate-schema"

// GET /api/groups — список групп организации
export async function GET() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const groups = await db.group.findMany({
    // Скрываем технические одноразовые группы — они существуют только как
    // контейнер для разового Lesson и не должны светиться в списках.
    where: { tenantId, deletedAt: null, isOneTime: false },
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

const salaryRateInputSchema = z.object({
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

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Формат даты: YYYY-MM-DD")
  .transform((v) => new Date(v))

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
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  salaryRate: salaryRateInputSchema.optional(),
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

  const {
    templates,
    startDate: rawStartDate,
    endDate: rawEndDate,
    salaryRate,
    ...data
  } = parsed.data

  // Если дату старта не указали — берём сегодня. Если endDate не указали —
  // год вперёд от startDate (логика в getGenerationRange).
  const startDate = rawStartDate ?? new Date()

  // Если задана ставка — валидируем под её схему до записи в БД
  if (salaryRate) {
    const validationError = validateForScheme(salaryRate)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }
  }

  const group = await db.group.create({
    data: {
      ...data,
      tenantId,
      startDate,
      endDate: rawEndDate ?? null,
      templates: templates?.length
        ? {
            create: templates.map((t) => ({
              tenantId,
              dayOfWeek: t.dayOfWeek,
              startTime: t.startTime,
              durationMinutes: t.durationMinutes,
              effectiveFrom: startDate,
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

  // Опциональная ставка группы
  if (salaryRate) {
    const rate = await db.groupSalaryRate.create({
      data: {
        tenantId,
        groupId: group.id,
        scheme: salaryRate.scheme,
        ratePerStudent: salaryRate.ratePerStudent ?? null,
        ratePerLesson: salaryRate.ratePerLesson ?? null,
        fixedPerShift: salaryRate.fixedPerShift ?? null,
        percentOfPayments: salaryRate.percentOfPayments ?? null,
      },
    })
    if (salaryRate.brackets && salaryRate.brackets.length > 0) {
      await db.salaryBracket.createMany({
        data: salaryRate.brackets.map((b) => ({
          tenantId,
          groupSalaryRateId: rate.id,
          minStudents: b.minStudents,
          ratePerLesson: b.ratePerLesson,
        })),
      })
    }
  }

  // Автогенерация расписания: год вперёд от startDate, либо до endDate если задан.
  let generation: { created: number; skippedNonWorking: number } | null = null
  if (templates && templates.length > 0) {
    const { rangeStart, rangeEnd } = getGenerationRange(
      startDate,
      rawEndDate ?? null
    )
    const res = await generateGroupLessons({
      tenantId,
      groupId: group.id,
      instructorId: group.instructorId,
      templates,
      rangeStart,
      rangeEnd,
    })
    generation = { created: res.created, skippedNonWorking: res.skippedNonWorking }
  }

  return NextResponse.json({ ...group, generation }, { status: 201 })
}
