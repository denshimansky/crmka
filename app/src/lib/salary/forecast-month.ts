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

/**
 * Прогноз ЗП педагогов за месяц для дашборда («Прогноз прибыли»).
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
export async function computeMonthlySalaryForecast(
  db: DB,
  tenantId: string,
  year: number,
  month: number,
): Promise<number> {
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
      group: { select: { directionId: true } },
    },
  })

  if (lessons.length === 0) return 0

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

  // Окладников засчитываем один раз (фикс за месяц), сдельщиков — по занятиям.
  const okladInstructors = new Set<string>()
  let pieceworkTotal = 0

  for (const l of lessons) {
    const effId = l.substituteInstructorId || l.instructorId
    if (okladMap.has(effId)) {
      okladInstructors.add(effId)
      continue
    }
    const rate = resolveRate(l.groupId, effId, l.group.directionId)
    if (!rate) continue
    pieceworkTotal += lessonPay(rate, enrollCount.get(l.groupId) || 0)
  }

  let okladTotal = 0
  for (const id of okladInstructors) okladTotal += okladMap.get(id) || 0

  return okladTotal + pieceworkTotal
}
