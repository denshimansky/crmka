import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { getNonWorkingDateSet } from "@/lib/production-calendar"

const generateSchema = z.object({
  month: z.number().min(1, "Месяц от 1 до 12").max(12, "Месяц от 1 до 12"),
  year: z.number().min(2024, "Укажите корректный год").max(2030, "Укажите корректный год"),
})

// POST /api/groups/[id]/generate — генерация занятий по шаблонам
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  const body = await request.json()
  const parsed = generateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { month, year } = parsed.data

  // Проверяем что группа принадлежит организации
  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { templates: { where: { effectiveTo: null } } },
  })

  if (!group) {
    return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  }

  if (group.templates.length === 0) {
    return NextResponse.json(
      { error: "У группы нет шаблонов расписания" },
      { status: 400 }
    )
  }

  // Получаем существующие занятия за месяц
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)

  const existingLessons = await db.lesson.findMany({
    where: {
      groupId: id,
      tenantId,
      date: { gte: firstDay, lte: lastDay },
    },
    select: { date: true, startTime: true },
  })

  // Набор существующих для проверки дубликатов
  const existingSet = new Set(
    existingLessons.map(
      (l) => `${l.date.toISOString().slice(0, 10)}_${l.startTime}`
    )
  )

  // Производственный календарь — нерабочие дни месяца
  const nonWorkingSet = await getNonWorkingDateSet(tenantId, firstDay, lastDay)
  const skippedDates: string[] = []

  // Генерация занятий
  const lessonsToCreate: Array<{
    tenantId: string
    groupId: string
    date: Date
    startTime: string
    durationMinutes: number
    instructorId: string
    status: "scheduled"
  }> = []

  for (const template of group.templates) {
    // Перебираем все дни месяца
    const current = new Date(firstDay)
    while (current <= lastDay) {
      // JS: 0=Sun, 1=Mon... Prisma шаблон: 0=Mon, 1=Tue... -> конвертируем
      const jsDay = current.getDay() // 0=Sun
      const templateDay = jsDay === 0 ? 6 : jsDay - 1 // 0=Mon

      if (templateDay === template.dayOfWeek) {
        const dateStr = current.toISOString().slice(0, 10)
        const key = `${dateStr}_${template.startTime}`

        if (nonWorkingSet.has(dateStr)) {
          // Пропуск нерабочего дня — фиксируем для отчёта пользователю
          if (!skippedDates.includes(dateStr)) skippedDates.push(dateStr)
        } else if (!existingSet.has(key)) {
          lessonsToCreate.push({
            tenantId,
            groupId: id,
            date: new Date(dateStr),
            startTime: template.startTime,
            durationMinutes: template.durationMinutes,
            instructorId: group.instructorId,
            status: "scheduled",
          })
          existingSet.add(key) // на случай дублирующихся шаблонов
        }
      }

      current.setDate(current.getDate() + 1)
    }
  }

  if (lessonsToCreate.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: skippedDates.length,
      skippedDates,
      message:
        skippedDates.length > 0
          ? `Все рабочие дни уже сгенерированы. Пропущено нерабочих: ${skippedDates.length}`
          : "Все занятия уже существуют",
    })
  }

  await db.lesson.createMany({ data: lessonsToCreate })

  return NextResponse.json({
    created: lessonsToCreate.length,
    skipped: skippedDates.length,
    skippedDates,
    message:
      skippedDates.length > 0
        ? `Создано ${lessonsToCreate.length} занятий, пропущено ${skippedDates.length} нерабочих дней`
        : `Создано ${lessonsToCreate.length} занятий`,
  })
}
