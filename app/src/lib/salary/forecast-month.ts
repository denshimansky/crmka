import { Prisma, type PrismaClient, type SalaryScheme } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

interface RateLike {
  scheme: SalaryScheme
  ratePerStudent: Prisma.Decimal | null
  ratePerLesson: Prisma.Decimal | null
  fixedPerShift: Prisma.Decimal | null
  percentOfPayments: Prisma.Decimal | null
  brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
}

/** Строка прогноза по одному педагогу за месяц. */
export interface InstructorForecastRow {
  instructorId: string
  instructorName: string
  /** Оклад перекрывает сдельный расчёт: для окладника forecast = его оклад. */
  isOklad: boolean
  forecast: number
  lessonsCount: number
  /** Σ учеников по занятиям месяца (оценка по активным зачислениям групп). */
  studentsCount: number
  /** Направления, которые педагог ведёт в месяце (уникальные имена). */
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
 * Прогноз ЗП педагогов за месяц с разбивкой по педагогам.
 *
 * Правило владельца: «ЗП педагогов пишется или оклад если есть, или
 * подсчитывается по ставке и количеству занятий».
 *
 *   • Окладник (Employee.monthlySalary > 0) → берём оклад как фикс за месяц,
 *     независимо от числа занятий. Оклад перекрывает сдельный расчёт.
 *   • Сдельщик → по его ставке и занятиям месяца. Резолв ставки повторяет
 *     приоритет resolve-rate.ts: ставка группы (GroupSalaryRate) →
 *     личная по направлению → личная дефолтная. Число учеников на занятие
 *     оцениваем по активным зачислениям группы (прогноз на весь месяц).
 *
 * Считаем по «эффективному» инструктору занятия (замещающий, если задан),
 * только по не отменённым занятиям (scheduled/completed). «Педагог» — тот,
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

  const [oklads, groupRates, personalRates, enrollGroups] = await Promise.all([
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
      include: { brackets: { orderBy: { minStudents: "asc" } } },
    }),
    db.groupEnrollment.groupBy({
      by: ["groupId"],
      where: { tenantId, groupId: { in: groupIds }, isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
  ])

  const okladMap = new Map(oklads.map((e) => [e.id, Number(e.monthlySalary)]))
  const groupRateMap = new Map(groupRates.map((r) => [r.groupId, r as RateLike]))
  const personalByDir = new Map<string, RateLike>()
  const personalDefault = new Map<string, RateLike>()
  for (const r of personalRates) {
    if (r.directionId) personalByDir.set(`${r.employeeId}:${r.directionId}`, r as RateLike)
    else personalDefault.set(r.employeeId, r as RateLike)
  }
  const enrollCount = new Map(enrollGroups.map((g) => [g.groupId, g._count._all]))

  function resolveRate(groupId: string, employeeId: string, directionId: string): RateLike | null {
    return (
      groupRateMap.get(groupId) ||
      personalByDir.get(`${employeeId}:${directionId}`) ||
      personalDefault.get(employeeId) ||
      null
    )
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

    // Окладник: оклад — фикс за месяц (не за занятие). Считаем занятия, но
    // forecast = оклад (проставляется один раз ниже). Оклад перекрывает сдельку.
    if (okladMap.has(effId)) {
      const a = ensure(effId, name, true)
      a.lessonsCount += 1
      if (l.group.direction?.name) a.directions.add(l.group.direction.name)
      continue
    }

    const rate = resolveRate(l.groupId, effId, l.group.directionId)
    if (!rate) continue
    const students = enrollCount.get(l.groupId) || 0
    const a = ensure(effId, name, false)
    a.forecast += lessonPay(rate, students)
    a.lessonsCount += 1
    a.studentsCount += students
    if (l.group.direction?.name) a.directions.add(l.group.direction.name)
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
      forecast: a.isOklad ? (okladMap.get(a.instructorId) || 0) : a.forecast,
      lessonsCount: a.lessonsCount,
      studentsCount: a.studentsCount,
      directionNames: [...a.directions],
      scheme,
    })
  }

  const total = rows.reduce((s, r) => s + r.forecast, 0)
  return { total, rows }
}

/** Прогноз ЗП педагогов за месяц для дашборда («Прогноз прибыли») — сумма. */
export async function computeMonthlySalaryForecast(
  db: DB,
  tenantId: string,
  year: number,
  month: number,
): Promise<number> {
  const { total } = await computeSalaryForecastBreakdown(db, tenantId, year, month)
  return total
}
