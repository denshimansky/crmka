import { Prisma, type PrismaClient, type SalaryScheme } from "@prisma/client"
import { pickRateAt } from "./pick-rate-at"

type DB = PrismaClient | Prisma.TransactionClient

interface RateLike {
  scheme: SalaryScheme
  ratePerStudent: Prisma.Decimal | null
  ratePerLesson: Prisma.Decimal | null
  fixedPerShift: Prisma.Decimal | null
  percentOfPayments: Prisma.Decimal | null
  brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
}

/** Строка прогноза по одному инструктору за месяц. */
export interface InstructorForecastRow {
  instructorId: string
  instructorName: string
  /** Окладник: forecast = оклад + сдельное начисление за проведённые занятия. */
  isOklad: boolean
  forecast: number
  lessonsCount: number
  /** Σ учеников по занятиям месяца (оценка по активным зачислениям групп). */
  studentsCount: number
  /** Направления, которые инструктор ведёт в месяце (уникальные имена). */
  directionNames: string[]
  /** Преобладающая схема сдельщика (чаще всего одна). null у окладника. */
  scheme: SalaryScheme | null
}

export interface SalaryForecastBreakdown {
  total: number
  rows: InstructorForecastRow[]
}

/** Оплата за одно занятие по ставке и числу учеников (факт-эквивалент). */
function lessonPay(rate: RateLike, students: number): number {
  switch (rate.scheme) {
    case "per_lesson":
      return Number(rate.ratePerLesson || 0)
    case "per_student":
    case "fixed_plus_per_student":
      // fixed_plus_per_student исторически платит только ratePerStudent —
      // «фикс за выход» (fixedPerShift) в фактический расчёт не входит
      // (см. calc-pay.ts). Прогноз должен совпадать с фактом.
      return Number(rate.ratePerStudent || 0) * students
    case "floating_by_students": {
      const bracket = [...rate.brackets]
        .filter((b) => b.minStudents <= students)
        .sort((a, b) => b.minStudents - a.minStudents)[0]
      return bracket ? Number(bracket.ratePerLesson) : 0
    }
    case "percent_of_payments":
    default:
      return 0
  }
}

/**
 * Прогноз ЗП инструкторов за месяц с разбивкой по инструкторам.
 *
 * Правило владельца: «ЗП инструкторов пишется или оклад если есть, или
 * подсчитывается по ставке и количеству занятий».
 *
 *   • Окладник (Employee.monthlySalary > 0) → оклад как фикс за месяц ПЛЮС
 *     сдельное начисление за проведённые занятия (если ставка резолвится).
 *   • Сдельщик → по его ставке и занятиям месяца. Резолв ставки повторяет
 *     приоритет resolve-rate.ts: ставка группы (GroupSalaryRate) →
 *     личная по направлению → личная дефолтная. Число учеников на занятие
 *     оцениваем по активным зачислениям группы (прогноз на весь месяц).
 *
 * Считаем по «эффективному» инструктору занятия (замещающий, если задан),
 * только по не отменённым занятиям (scheduled/completed). «Инструктор» — тот,
 * кто реально ведёт занятия в месяце; оклад АУП без занятий сюда не попадает
 * (он уходит в «постоянные платежи» как плановый расход). Это согласуется с
 * каноном reports-logic.md §7.1 «Прогноз ЗП = автомат из расписания + ставок».
 *
 * percent_of_payments спрогнозировать без фактических списаний нельзя → 0.
 */
export async function computeSalaryForecastBreakdown(
  db: DB,
  tenantId: string,
  year: number,
  month: number,
): Promise<SalaryForecastBreakdown> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: monthStart, lte: monthEnd },
      status: { in: ["scheduled", "completed"] },
    },
    select: {
      id: true,
      date: true,
      groupId: true,
      instructorId: true,
      substituteInstructorId: true,
      instructor: { select: { id: true, firstName: true, lastName: true } },
      substituteInstructor: { select: { id: true, firstName: true, lastName: true } },
      group: {
        select: { directionId: true, direction: { select: { name: true } } },
      },
    },
  })

  if (lessons.length === 0) return { total: 0, rows: [] }

  const groupIds = [...new Set(lessons.map((l) => l.groupId))]
  const instructorIds = [
    ...new Set(lessons.map((l) => l.substituteInstructorId || l.instructorId)),
  ]

  const [oklads, groupRates, personalRates, enrollGroups, orgTypeRow] = await Promise.all([
    db.employee.findMany({
      where: { tenantId, deletedAt: null, monthlySalary: { not: null } },
      select: { id: true, monthlySalary: true },
    }),
    db.groupSalaryRate.findMany({
      where: { tenantId, groupId: { in: groupIds } },
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    }),
    db.salaryRate.findMany({
      where: { tenantId, employeeId: { in: instructorIds } },
      include: {
        brackets: { orderBy: { minStudents: "asc" } },
        schedules: {
          where: { deletedAt: null },
          orderBy: { effectiveFrom: "asc" },
          include: { brackets: { orderBy: { minStudents: "asc" } } },
        },
      },
    }),
    db.groupEnrollment.groupBy({
      by: ["groupId"],
      where: { tenantId, groupId: { in: groupIds }, isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
    db.organization.findUnique({
      where: { id: tenantId },
      select: { subscriptionType: true },
    }),
  ])

  const okladMap = new Map(oklads.map((e) => [e.id, Number(e.monthlySalary)]))
  const groupRateMap = new Map(groupRates.map((r) => [r.groupId, r as RateLike]))
  const personalByDir = new Map<string, RateLike & { schedules: (RateLike & { effectiveFrom: Date; deletedAt: Date | null })[] }>()
  const personalDefault = new Map<string, RateLike & { schedules: (RateLike & { effectiveFrom: Date; deletedAt: Date | null })[] }>()
  for (const r of personalRates) {
    const v = r as RateLike & { schedules: (RateLike & { effectiveFrom: Date; deletedAt: Date | null })[] }
    if (r.directionId) personalByDir.set(`${r.employeeId}:${r.directionId}`, v)
    else personalDefault.set(r.employeeId, v)
  }
  const enrollCount = new Map(enrollGroups.map((g) => [g.groupId, g._count._all]))

  // Пакетный тип: число учеников на занятие для схем per_student/floating берём
  // по-занятийно (кто выбрал ИМЕННО это занятие) + легаси/календарные (без строк
  // выбора) как постоянный счёт группы. Иначе прогноз завышается на невыбранных.
  const isPackageOrg = orgTypeRow?.subscriptionType === "package"
  const selByLesson = new Map<string, Set<string>>()
  const selectingByGroup = new Map<string, Set<string>>()
  if (isPackageOrg) {
    const selRows = await db.subscriptionLesson.findMany({
      where: {
        tenantId,
        lessonId: { in: lessons.map((l) => l.id) },
        subscription: { type: "package", status: { in: ["active", "pending"] }, deletedAt: null },
      },
      select: {
        lessonId: true,
        subscription: { select: { groupId: true, clientId: true, wardId: true } },
      },
    })
    for (const r of selRows) {
      const key = `${r.subscription.clientId}:${r.subscription.wardId || ""}`
      let s = selByLesson.get(r.lessonId)
      if (!s) { s = new Set(); selByLesson.set(r.lessonId, s) }
      s.add(key)
      let g = selectingByGroup.get(r.subscription.groupId)
      if (!g) { g = new Set(); selectingByGroup.set(r.subscription.groupId, g) }
      g.add(key)
    }
  }

  function resolveRate(
    groupId: string,
    employeeId: string,
    directionId: string,
    atDate: Date,
  ): RateLike | null {
    const group = groupRateMap.get(groupId)
    if (group) return group
    const exc = personalByDir.get(`${employeeId}:${directionId}`)
    if (exc) return pickRateAt(exc, exc.schedules, atDate) as RateLike
    const def = personalDefault.get(employeeId)
    if (def) return pickRateAt(def, def.schedules, atDate) as RateLike
    return null
  }

  interface Acc {
    instructorId: string
    instructorName: string
    isOklad: boolean
    forecast: number
    lessonsCount: number
    studentsCount: number
    directions: Set<string>
    schemeCount: Map<SalaryScheme, number>
  }
  const acc = new Map<string, Acc>()
  const ensure = (id: string, name: string, isOklad: boolean): Acc => {
    let a = acc.get(id)
    if (!a) {
      a = {
        instructorId: id, instructorName: name, isOklad,
        forecast: 0, lessonsCount: 0, studentsCount: 0,
        directions: new Set(), schemeCount: new Map(),
      }
      acc.set(id, a)
    }
    return a
  }

  for (const l of lessons) {
    const eff = l.substituteInstructorId ? l.substituteInstructor : l.instructor
    const effId = l.substituteInstructorId || l.instructorId
    const name = [eff?.lastName, eff?.firstName].filter(Boolean).join(" ") || effId

    // Оклад + сделка суммируются: у окладника считаем и оклад (фикс за месяц,
    // прибавляется в сборке строк ниже), и сдельное начисление за проведённые
    // занятия. Если ставка не резолвится — сделочная часть просто 0 (только оклад).
    const isOklad = okladMap.has(effId)
    const a = ensure(effId, name, isOklad)
    a.lessonsCount += 1
    if (l.group.direction?.name) a.directions.add(l.group.direction.name)

    const rate = resolveRate(l.groupId, effId, l.group.directionId, new Date(l.date))
    if (!rate) continue
    const students = isPackageOrg
      ? Math.max(0, (enrollCount.get(l.groupId) || 0) - (selectingByGroup.get(l.groupId)?.size ?? 0)) +
        (selByLesson.get(l.id)?.size ?? 0)
      : enrollCount.get(l.groupId) || 0
    a.forecast += lessonPay(rate, students)
    a.studentsCount += students
    a.schemeCount.set(rate.scheme, (a.schemeCount.get(rate.scheme) || 0) + 1)
  }

  const rows: InstructorForecastRow[] = []
  for (const a of acc.values()) {
    // Преобладающая схема — с наибольшим числом занятий.
    let scheme: SalaryScheme | null = null
    let best = -1
    for (const [s, n] of a.schemeCount) if (n > best) { best = n; scheme = s }
    rows.push({
      instructorId: a.instructorId,
      instructorName: a.instructorName,
      isOklad: a.isOklad,
      forecast: a.forecast + (a.isOklad ? (okladMap.get(a.instructorId) || 0) : 0),
      lessonsCount: a.lessonsCount,
      studentsCount: a.studentsCount,
      directionNames: [...a.directions],
      scheme,
    })
  }

  const total = rows.reduce((s, r) => s + r.forecast, 0)
  return { total, rows }
}

/** Прогноз ЗП инструкторов за месяц для дашборда («Прогноз прибыли») — сумма. */
export async function computeMonthlySalaryForecast(
  db: DB,
  tenantId: string,
  year: number,
  month: number,
): Promise<number> {
  const { total } = await computeSalaryForecastBreakdown(db, tenantId, year, month)
  return total
}
