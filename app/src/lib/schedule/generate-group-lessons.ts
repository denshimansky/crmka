import { db } from "@/lib/db"
import { getNonWorkingDateSet } from "@/lib/production-calendar"
import { recalcSubscriptionsOnScheduleChange } from "@/lib/subscriptions/recalc-on-schedule-change"
import {
  snapshotPackageSelections,
  createReselectPackageLessonTasks,
} from "@/lib/tasks/reselect-package-lesson"

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

/** Занятие-кандидат на удаление при перегенерации расписания группы. */
export interface RegenLessonRow {
  id: string
  date: Date
  startTime: string
  status: string
  /** Дата, с которой занятие вручную перенесли (null — никогда не переносили). */
  rescheduledFromDate: Date | null
  /** Занятие вне [startDate, endDate] группы — кандидат независимо от шаблонов. */
  outOfBounds?: boolean
  _count: {
    /** Любые отметки, включая заглушки «Не отмечен» (isPending). */
    attendances: number
    /** Активные пробные: scheduled / attended / no_show. */
    trialLessons: number
    /** Отработки, назначенные НА это занятие (makeup_scheduled). */
    scheduledMakeupAttendances: number
  }
}

export interface RegenPartition {
  /** Занятия к физическому удалению. */
  toDelete: string[]
  /** Их даты (без отменённых) — для дельта-пересчёта абонементов. */
  removedDates: Date[]
  /** Сохранены, потому что есть отметки. */
  keptWithAttendance: number
  /** Сохранены, потому что на них записаны активные пробные. */
  keptWithTrials: number
  /** Сохранены, потому что их вручную перенёс человек. */
  keptRescheduled: number
  /** Сохранены, потому что на них назначены отработки. */
  keptWithScheduledMakeup: number
}

/**
 * Чистое ядро перегенерации: какие занятия вне текущих шаблонов удаляемы.
 *
 * Занятие вне шаблонов НЕ удаляем, если оно хоть чем-то «занято человеком»:
 *  • есть отметки посещений — прошлое не откатываем (было и раньше);
 *  • есть активные пробные — тот же guard, что в одиночном DELETE занятия и в
 *    реконсиляции дня (partitionDeletableLessons). Групповое пробное не создаёт
 *    Attendance до отметки и живёт ссылкой trial_lessons.lesson_id, у которой FK
 *    стоит ON DELETE SET NULL: удаление занятия молча обнуляло ссылку, и пробное
 *    превращалось в сироту — без времени, без карточки занятия и вне состава
 *    (кейс «ДЦ Умный Я», 05.09.2026: занятие перенесли на субботу, записали два
 *    пробных, перегенерация занятие снесла);
 *  • на занятие назначена отработка (Attendance.scheduledMakeupLessonId с типом
 *    makeup_scheduled) — у этой ссылки FK тоже ON DELETE SET NULL, то есть
 *    удаление занятия молча превращало обязательство «придёт отрабатывать» в
 *    сироту: у пропуска на исходном занятии пропадала цель, и ни задачи, ни
 *    следа не оставалось (в отличие от отмены занятия, которая создаёт задачу
 *    «переназначить отработку» — см. PATCH /api/lessons/[id]);
 *  • занятие вручную перенесено (rescheduledFromDate) — осознанное решение
 *    администратора: после переноса на другой день недели занятие перестаёт
 *    попадать под шаблоны, и чистка по шаблонам молча откатывала перенос, о
 *    котором уже знают родители. Правка срока жизни группы — не повод сносить
 *    отдельно согласованный перенос занятия.
 *
 * Сохранённое занятие остаётся в сетке рядом с досозданным по шаблону: так же
 * ведёт себя защита по отметкам, и это видно администратору, в отличие от
 * бесследного удаления (перегенерация не пишет ни deleted_lessons, ни audit_log).
 */
export function partitionRegenLessons(
  lessons: RegenLessonRow[],
  allowed: Set<string>,
): RegenPartition {
  const res: RegenPartition = {
    toDelete: [],
    removedDates: [],
    keptWithAttendance: 0,
    keptWithTrials: 0,
    keptRescheduled: 0,
    keptWithScheduledMakeup: 0,
  }
  for (const l of lessons) {
    const inTemplate =
      !l.outOfBounds &&
      allowed.has(`${jsDayToTemplateDay(l.date.getDay())}_${l.startTime}`)
    if (inTemplate) continue

    if (l._count.attendances > 0) {
      res.keptWithAttendance++
      continue
    }
    if (l._count.trialLessons > 0) {
      res.keptWithTrials++
      continue
    }
    if (l._count.scheduledMakeupAttendances > 0) {
      res.keptWithScheduledMakeup++
      continue
    }
    if (l.rescheduledFromDate !== null) {
      res.keptRescheduled++
      continue
    }

    res.toDelete.push(l.id)
    // Отменённые в счёт не идут: отмена не декрементила totalLessons
    // (вариант A) — их физическое удаление дельты не даёт.
    if (l.status !== "cancelled") res.removedDates.push(l.date)
  }
  return res
}

/**
 * Изменились ли РЕАЛЬНО даты жизни группы. Только это должно запускать
 * перестройку расписания (regenerateOnDateChange).
 *
 * Форма «Настройки» карточки группы шлёт startDate/endDate в каждом PATCH —
 * даже когда правили одно название. Пока гейт проверял лишь «пришёл ли ключ»,
 * любое «Сохранить» без единого изменения прогоняло полную перестройку:
 * занятия вне шаблонов удалялись, недостающие досоздавались, а живые абонементы
 * пересчитывались через recalcSubscriptionsOnScheduleChange — то есть у клиентов
 * двигались суммы и долги. Так и пропало занятие с двумя пробными 05.09.2026.
 *
 * undefined — ключа в payload не было (поле не трогали); null — дату сняли.
 * Сравниваем по календарному дню: границы всё равно нормализуются к полуночи.
 */
export function groupLifeDatesChanged(
  existing: { startDate: Date | null; endDate: Date | null },
  next: { startDate?: string | null; endDate?: string | null },
): boolean {
  const day = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null
  const changed = (cur: Date | null, incoming: string | null | undefined) =>
    incoming !== undefined && day(cur) !== incoming
  return (
    changed(existing.startDate, next.startDate) ||
    changed(existing.endDate, next.endDate)
  )
}

/** Множество разрешённых слотов «деньНедели_время» из шаблонов группы. */
function allowedSlots(templates: ScheduleTemplate[]): Set<string> {
  return new Set(templates.map((t) => `${t.dayOfWeek}_${t.startTime}`))
}

/** Поля занятия, по которым partitionRegenLessons принимает решение. */
const REGEN_LESSON_SELECT = {
  id: true,
  date: true,
  startTime: true,
  status: true,
  rescheduledFromDate: true,
  _count: {
    select: {
      attendances: true,
      trialLessons: { where: { status: { not: "cancelled" as const } } },
      scheduledMakeupAttendances: {
        where: { attendanceType: { code: "makeup_scheduled" } },
      },
    },
  },
} as const

interface BaseOptions {
  tenantId: string
  groupId: string
  instructorId: string
  templates: ScheduleTemplate[]
  rangeStart: Date // inclusive
  rangeEnd: Date // inclusive
  /** Автор изменения — для истории скидок при пересчёте абонементов. */
  createdBy?: string | null
  /** Внутренний флаг regenerate*-обёрток: пересчёт абонементов делает обёртка
   * одной дельтой (созданные + удалённые), а не по частям. */
  skipSubscriptionRecalc?: boolean
}

interface GenerationResult {
  created: number
  deleted: number
  skippedNonWorking: number
  skippedDates: string[]
  /** Даты созданных занятий — для дельта-пересчёта абонементов. */
  createdDates: Date[]
  /** Сколько абонементов пересчитано (totalLessons/деньги). */
  subscriptionsUpdated: number
  /** Занятий вне шаблонов сохранено: есть отметки. */
  keptWithAttendance: number
  /** Занятий вне шаблонов сохранено: записаны активные пробные. */
  keptWithTrials: number
  /** Занятий вне шаблонов сохранено: вручную перенесены администратором. */
  keptRescheduled: number
  /** Занятий вне шаблонов сохранено: на них назначены отработки. */
  keptWithScheduledMakeup: number
}

/** Нулевые счётчики сохранённых занятий — для чисто additive-генерации. */
const NO_KEPT = {
  keptWithAttendance: 0,
  keptWithTrials: 0,
  keptRescheduled: 0,
  keptWithScheduledMakeup: 0,
} as const

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
    return {
      created: 0,
      deleted: 0,
      skippedNonWorking: 0,
      skippedDates: [],
      createdDates: [],
      subscriptionsUpdated: 0,
      ...NO_KEPT,
    }
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

  const createdDates = toCreate.map((l) => l.date)

  // Живые календарные абонементы группы получают +N занятий в своём диапазоне
  // (и долг на ту же сумму). При создании группы абонементов ещё нет — no-op.
  let subscriptionsUpdated = 0
  if (!opts.skipSubscriptionRecalc && createdDates.length > 0) {
    const recalc = await recalcSubscriptionsOnScheduleChange(db, {
      tenantId,
      groupId,
      addedDates: createdDates,
      removedDates: [],
      createdBy: opts.createdBy ?? null,
    })
    subscriptionsUpdated = recalc.updated
  }

  return {
    created: toCreate.length,
    deleted: 0,
    skippedNonWorking: skipped.size,
    skippedDates: Array.from(skipped),
    createdDates,
    subscriptionsUpdated,
    ...NO_KEPT,
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
    select: REGEN_LESSON_SELECT,
  })

  // Что удаляем, что оставляем — см. partitionRegenLessons (отметки, активные
  // пробные, отработки и ручные переносы занятие защищают).
  const part = partitionRegenLessons(futureLessons, allowedSlots(templates))
  const { toDelete, removedDates } = part

  // Пакет с выбором: снимок выборов ДО удаления (cascade сотрёт строки
  // SubscriptionLesson), задачи на перевыбор — после. Тот же порядок, что в
  // одиночном DELETE занятия и в реконсиляции дня; раньше перегенерация
  // стирала выбор занятия пакета молча, без задачи оператору.
  const selSnapshot = await snapshotPackageSelections(db, tenantId, toDelete)

  if (toDelete.length > 0) {
    await db.lesson.deleteMany({ where: { id: { in: toDelete } } })
  }
  await createReselectPackageLessonTasks(db, tenantId, selSnapshot, opts.createdBy ?? null)

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
    skipSubscriptionRecalc: true,
  })

  // Пересчёт абонементов одной дельтой: созданные и удалённые вместе.
  const recalc = await recalcSubscriptionsOnScheduleChange(db, {
    tenantId,
    groupId,
    addedDates: created.createdDates,
    removedDates,
    createdBy: opts.createdBy ?? null,
  })

  return {
    created: created.created,
    deleted: toDelete.length,
    skippedNonWorking: created.skippedNonWorking,
    skippedDates: created.skippedDates,
    createdDates: created.createdDates,
    subscriptionsUpdated: recalc.updated,
    keptWithAttendance: part.keptWithAttendance,
    keptWithTrials: part.keptWithTrials,
    keptRescheduled: part.keptRescheduled,
    keptWithScheduledMakeup: part.keptWithScheduledMakeup,
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
  createdBy?: string | null
}): Promise<GenerationResult> {
  const { tenantId, groupId, instructorId, templates, startDate, endDate } = opts

  const startBound = startDate ? new Date(startDate) : null
  if (startBound) startBound.setHours(0, 0, 0, 0)
  const endBound = endDate ? new Date(endDate) : null
  if (endBound) endBound.setHours(0, 0, 0, 0)

  const allLessons = await db.lesson.findMany({
    where: { tenantId, groupId },
    select: REGEN_LESSON_SELECT,
  })

  // Вне [startDate, endDate] — кандидат на удаление независимо от шаблонов;
  // внутри — решает попадание в шаблон. Защиты (отметки, активные пробные,
  // ручной перенос) действуют в обоих случаях: см. partitionRegenLessons.
  const part = partitionRegenLessons(
    allLessons.map((l) => {
      const lessonDay = new Date(l.date)
      lessonDay.setHours(0, 0, 0, 0)
      return {
        ...l,
        outOfBounds:
          (startBound !== null && lessonDay < startBound) ||
          (endBound !== null && lessonDay > endBound),
      }
    }),
    allowedSlots(templates),
  )
  const { toDelete, removedDates } = part

  // Снимок выборов пакетов ДО удаления, задачи на перевыбор — после (см.
  // regenerateGroupSchedule выше).
  const selSnapshot = await snapshotPackageSelections(db, tenantId, toDelete)

  if (toDelete.length > 0) {
    await db.lesson.deleteMany({ where: { id: { in: toDelete } } })
  }
  await createReselectPackageLessonTasks(db, tenantId, selSnapshot, opts.createdBy ?? null)

  if (templates.length === 0) {
    const recalc = await recalcSubscriptionsOnScheduleChange(db, {
      tenantId,
      groupId,
      addedDates: [],
      removedDates,
      createdBy: opts.createdBy ?? null,
    })
    return {
      created: 0,
      deleted: toDelete.length,
      skippedNonWorking: 0,
      skippedDates: [],
      createdDates: [],
      subscriptionsUpdated: recalc.updated,
      keptWithAttendance: part.keptWithAttendance,
      keptWithTrials: part.keptWithTrials,
      keptRescheduled: part.keptRescheduled,
      keptWithScheduledMakeup: part.keptWithScheduledMakeup,
    }
  }

  const { rangeStart, rangeEnd } = getGenerationRange(startDate, endDate)
  const created = await generateGroupLessons({
    tenantId,
    groupId,
    instructorId,
    templates,
    rangeStart,
    rangeEnd,
    skipSubscriptionRecalc: true,
  })

  // Пересчёт абонементов одной дельтой: созданные и удалённые вместе.
  const recalc = await recalcSubscriptionsOnScheduleChange(db, {
    tenantId,
    groupId,
    addedDates: created.createdDates,
    removedDates,
    createdBy: opts.createdBy ?? null,
  })

  return {
    created: created.created,
    deleted: toDelete.length,
    skippedNonWorking: created.skippedNonWorking,
    skippedDates: created.skippedDates,
    createdDates: created.createdDates,
    subscriptionsUpdated: recalc.updated,
    keptWithAttendance: part.keptWithAttendance,
    keptWithTrials: part.keptWithTrials,
    keptRescheduled: part.keptRescheduled,
    keptWithScheduledMakeup: part.keptWithScheduledMakeup,
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
