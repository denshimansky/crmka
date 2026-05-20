import { db } from "@/lib/db"

/**
 * Возвращает Set дат-строк (YYYY-MM-DD), которые помечены как НЕрабочие
 * в производственном календаре организации за интервал [from, to].
 */
export async function getNonWorkingDateSet(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const items = await db.productionCalendar.findMany({
    where: {
      tenantId,
      date: { gte: from, lte: to },
      isWorking: false,
    },
    select: { date: true },
  })
  return new Set(items.map((i) => i.date.toISOString().slice(0, 10)))
}

/**
 * Проверяет, является ли конкретная дата нерабочей по календарю организации.
 * Возвращает запись календаря или null. Если null — день считается рабочим
 * (нет явной отметки) или явно помечен как рабочий.
 */
export async function getNonWorkingDay(
  tenantId: string,
  date: Date,
): Promise<{ date: Date; comment: string | null } | null> {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  const next = new Date(day)
  next.setDate(next.getDate() + 1)

  const item = await db.productionCalendar.findFirst({
    where: {
      tenantId,
      date: { gte: day, lt: next },
      isWorking: false,
    },
    select: { date: true, comment: true },
  })
  return item
}

/**
 * Создаёт уведомление для всех владельцев и управляющих тенанта
 * о том, что назначено занятие в нерабочий день. Тип `empty_group` —
 * существующий enum, используем его как наиболее нейтральный канал
 * предупреждений (отдельный тип потребовал бы миграции).
 */
export async function notifyHolidayLesson(opts: {
  tenantId: string
  lessonId: string
  date: Date
  comment: string | null
}) {
  const recipients = await db.employee.findMany({
    where: {
      tenantId: opts.tenantId,
      deletedAt: null,
      isActive: true,
      role: { in: ["owner", "manager"] },
    },
    select: { id: true },
  })

  if (recipients.length === 0) return

  const dateStr = opts.date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

  const title = "Занятие в нерабочий день"
  const message = opts.comment
    ? `Назначено занятие на ${dateStr} (${opts.comment}) — проверьте, что это намеренно.`
    : `Назначено занятие на ${dateStr}, помеченный в производственном календаре как нерабочий.`

  await db.notification.createMany({
    data: recipients.map((r) => ({
      tenantId: opts.tenantId,
      employeeId: r.id,
      type: "empty_group" as const,
      title,
      message,
      entityType: "Lesson",
      entityId: opts.lessonId,
    })),
  })
}
