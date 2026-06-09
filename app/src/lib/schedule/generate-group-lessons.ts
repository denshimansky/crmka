import { db } from "@/lib/db"
import { getNonWorkingDateSet } from "@/lib/production-calendar"

/**
 * День года в формате YYYY-MM-DD без учёта таймзоны (используем локальную дату).
 */
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Конвертирует JS-овый getDay() (0=Sun..6=Sat) в формат шаблонов (0=Mon..6=Sun).
 */
function jsDayToTemplateDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
}

export interface ScheduleTemplate {
  dayOfWeek: number
  startTime: string
  durationMinutes: number
}

interface BaseOptions {
  tenantId: string
  groupId: string
  instructorId: string
  templates: ScheduleTemplate[]
  rangeStart: Date // inclusive
  rangeEnd: Date // inclusive
}

interface GenerationResult {
  created: number
  deleted: number
  skippedNonWorking: number
  skippedDates: string[]
}

/**
 * Создаёт занятия для группы за период [rangeStart, rangeEnd] по шаблонам.
 * Дубликаты пропускаются. Нерабочие дни производственного календаря — тоже.
 * НЕ удаляет существующие занятия.
 *
 * Используется при создании группы или явной генерации на месяц.
 */
export async function generateGroupLessons(
  opts: BaseOptions
): Promise<GenerationResult> {
  const { tenantId, groupId, instructorId, templates, rangeStart, rangeEnd } =
    opts

  if (templates.length === 0) {
    return { created: 0, deleted: 0, skippedNonWorking: 0, skippedDates: [] }
  }

  // Существующие занятия в диапазоне — чтобы не создавать дубли
  const existing = await db.lesson.findMany({
    where: {
      tenantId,
      groupId,
      date: { gte: rangeStart, lte: rangeEnd },
    },
    select: { date: true, startTime: true },
  })
  const existingKeys = new Set(
    existing.map((l) => `${ymd(l.date)}_${l.startTime}`)
  )

  // Нерабочие дни из производственного календаря
  const nonWorking = await getNonWorkingDateSet(
    tenantId,
    rangeStart,
    rangeEnd
  )
  const skipped = new Set<string>()

  const toCreate: Array<{
    tenantId: string
    groupId: string
    date: Date
    startTime: string
    durationMinutes: number
    instructorId: string
    status: "scheduled"
  }> = []

  const cursor = new Date(rangeStart)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(rangeEnd)
  end.setHours(0, 0, 0, 0)

  while (cursor <= end) {
    const tDay = jsDayToTemplateDay(cursor.getDay())
    const dateStr = ymd(cursor)
    for (const t of templates) {
      if (t.dayOfWeek !== tDay) continue
      if (nonWorking.has(dateStr)) {
        skipped.add(dateStr)
        continue
      }
      const key = `${dateStr}_${t.startTime}`
      if (existingKeys.has(key)) continue
      toCreate.push({
        tenantId,
        groupId,
        date: new Date(cursor),
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        instructorId,
        status: "scheduled",
      })
      existingKeys.add(key)
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  if (toCreate.length > 0) {
    await db.lesson.createMany({ data: toCreate })
  }

  return {
    created: toCreate.length,
    deleted: 0,
    skippedNonWorking: skipped.size,
    skippedDates: Array.from(skipped),
  }
}

/**
 * Перегенерация расписания группы при смене шаблонов.
 *
 * Бизнес-правила:
 * - Прошлое не трогаем: занятия с `date < today` остаются как есть.
 * - В будущем удаляем занятия, которые больше НЕ попадают под новые шаблоны,
 *   при условии что у них нет посещений (Attendance) — иначе пропускаем
 *   удаление, чтобы не потерять данные.
 * - Добавляем недостающие занятия по новым шаблонам.
 * - Нерабочие дни календаря — пропускаем.
 *
 * `rangeEnd` обычно = startDate (если есть) + 1 год или endDate группы.
 */
export async function regenerateGroupSchedule(
  opts: BaseOptions & { today?: Date }
): Promise<GenerationResult> {
  const {
    tenantId,
    groupId,
    instructorId,
    templates,
    rangeStart,
    rangeEnd,
  } = opts

  const today = new Date(opts.today ?? new Date())
  today.setHours(0, 0, 0, 0)

  // Будущие занятия группы (от сегодня до rangeEnd)
  const futureLessons = await db.lesson.findMany({
    where: {
      tenantId,
      groupId,
      date: { gte: today, lte: rangeEnd },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      attendances: { select: { id: true }, take: 1 },
    },
  })

  // Множество (день недели, startTime) из новых шаблонов
  const allowed = new Set(
    templates.map((t) => `${t.dayOfWeek}_${t.startTime}`)
  )

  const toDelete: string[] = []
  const surviving = new Set<string>()

  for (const l of futureLessons) {
    const tDay = jsDayToTemplateDay(l.date.getDay())
    const slot = `${tDay}_${l.startTime}`
    if (allowed.has(slot)) {
      surviving.add(`${ymd(l.date)}_${l.startTime}`)
      continue
    }
    // Удалить можно только если нет посещений
    if (l.attendances.length === 0) {
      toDelete.push(l.id)
    } else {
      // Сохраняем как есть — не трогаем уже отмеченное
      surviving.add(`${ymd(l.date)}_${l.startTime}`)
    }
  }

  if (toDelete.length > 0) {
    await db.lesson.deleteMany({ where: { id: { in: toDelete } } })
  }

  // Теперь добавляем недостающие. rangeStart должен быть не раньше сегодня,
  // потому что прошлое не пересоздаём.
  const effectiveStart = rangeStart < today ? today : rangeStart

  const created = await generateGroupLessons({
    tenantId,
    groupId,
    instructorId,
    templates,
    rangeStart: effectiveStart,
    rangeEnd,
  })

  return {
    created: created.created,
    deleted: toDelete.length,
    skippedNonWorking: created.skippedNonWorking,
    skippedDates: created.skippedDates,
  }
}

/**
 * Перегенерация при изменении дат жизни группы (startDate / endDate).
 *
 * Отличия от regenerateGroupSchedule (тот вызывается при смене шаблонов и
 * замораживает прошлое относительно today):
 * - Опорные точки — startDate и endDate группы, а не today.
 * - Любое занятие ВНЕ [startDate, endDate]: с посещениями — оставляем,
 *   без посещений — удаляем (как в прошлом, так и в будущем).
 * - Внутри диапазона: занятие, не попадающее под текущие шаблоны и без
 *   посещений — удаляем; с посещениями — оставляем.
 * - Догенерируем недостающие занятия по шаблонам во всём [startDate, endDate],
 *   включая прошлые даты (если startDate сдвинули влево).
 *
 * Если startDate/endDate группы = null — соответствующая граница «бесконечна»,
 * по эту сторону чистка не выполняется.
 */
export async function regenerateOnDateChange(opts: {
  tenantId: string
  groupId: string
  instructorId: string
  templates: ScheduleTemplate[]
  startDate: Date | null
  endDate: Date | null
}): Promise<GenerationResult> {
  const { tenantId, groupId, instructorId, templates, startDate, endDate } = opts

  const startBound = startDate ? new Date(startDate) : null
  if (startBound) startBound.setHours(0, 0, 0, 0)
  const endBound = endDate ? new Date(endDate) : null
  if (endBound) endBound.setHours(0, 0, 0, 0)

  const allLessons = await db.lesson.findMany({
    where: { tenantId, groupId },
    select: {
      id: true,
      date: true,
      startTime: true,
      attendances: { select: { id: true }, take: 1 },
    },
  })

  const allowed = new Set(
    templates.map((t) => `${t.dayOfWeek}_${t.startTime}`)
  )

  const toDelete: string[] = []

  for (const l of allLessons) {
    const lessonDay = new Date(l.date)
    lessonDay.setHours(0, 0, 0, 0)
    const hasAttendance = l.attendances.length > 0
    const tooEarly = startBound !== null && lessonDay < startBound
    const tooLate = endBound !== null && lessonDay > endBound

    if (tooEarly || tooLate) {
      if (!hasAttendance) toDelete.push(l.id)
      continue
    }
    const tDay = jsDayToTemplateDay(l.date.getDay())
    if (allowed.has(`${tDay}_${l.startTime}`)) continue
    if (!hasAttendance) toDelete.push(l.id)
  }

  if (toDelete.length > 0) {
    await db.lesson.deleteMany({ where: { id: { in: toDelete } } })
  }

  if (templates.length === 0) {
    return { created: 0, deleted: toDelete.length, skippedNonWorking: 0, skippedDates: [] }
  }

  const { rangeStart, rangeEnd } = getGenerationRange(startDate, endDate)
  const created = await generateGroupLessons({
    tenantId,
    groupId,
    instructorId,
    templates,
    rangeStart,
    rangeEnd,
  })

  return {
    created: created.created,
    deleted: toDelete.length,
    skippedNonWorking: created.skippedNonWorking,
    skippedDates: created.skippedDates,
  }
}

/**
 * Возвращает диапазон [start, end] для автогенерации, исходя из
 * startDate / endDate группы. Если endDate не задан — год вперёд от startDate.
 */
export function getGenerationRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
): { rangeStart: Date; rangeEnd: Date } {
  const start = startDate ? new Date(startDate) : new Date()
  start.setHours(0, 0, 0, 0)

  let end: Date
  if (endDate) {
    end = new Date(endDate)
  } else {
    end = new Date(start)
    end.setFullYear(end.getFullYear() + 1)
  }
  end.setHours(23, 59, 59, 999)

  return { rangeStart: start, rangeEnd: end }
}
