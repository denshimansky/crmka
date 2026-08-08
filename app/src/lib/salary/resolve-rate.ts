import { Prisma, type PrismaClient, type SalaryScheme } from "@prisma/client"
import { pickRateAt } from "./pick-rate-at"

type DB = PrismaClient | Prisma.TransactionClient

export interface ResolvedRate {
  scheme: SalaryScheme
  ratePerStudent: Prisma.Decimal | null
  ratePerLesson: Prisma.Decimal | null
  fixedPerShift: Prisma.Decimal | null
  percentOfPayments: Prisma.Decimal | null
  brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
  source: "group" | "exception" | "default"
}

export interface ResolveRateInput {
  tenantId: string
  groupId: string
  employeeId: string
  directionId: string
}

// Снимок ставки (базовый SalaryRate/GroupSalaryRate или версия SalaryRateSchedule)
// → ResolvedRate. Все три носят одинаковый набор полей + brackets.
function toResolved(
  snap: {
    scheme: SalaryScheme
    ratePerStudent: Prisma.Decimal | null
    ratePerLesson: Prisma.Decimal | null
    fixedPerShift: Prisma.Decimal | null
    percentOfPayments: Prisma.Decimal | null
    brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
  },
  source: ResolvedRate["source"],
): ResolvedRate {
  return {
    scheme: snap.scheme,
    ratePerStudent: snap.ratePerStudent,
    ratePerLesson: snap.ratePerLesson,
    fixedPerShift: snap.fixedPerShift,
    percentOfPayments: snap.percentOfPayments,
    brackets: snap.brackets.map((b) => ({ minStudents: b.minStudents, ratePerLesson: b.ratePerLesson })),
    source,
  }
}

const withSchedules = {
  brackets: { orderBy: { minStudents: "asc" as const } },
  schedules: {
    where: { deletedAt: null },
    orderBy: { effectiveFrom: "asc" as const },
    include: { brackets: { orderBy: { minStudents: "asc" as const } } },
  },
} as const

/**
 * Резолвит, по какой ставке считать ЗП инструктору за занятие на дату `atDate`
 * (обычно Lesson.date — ЗП считается по фактической дате занятия).
 *
 * Приоритет (по требованию владельца):
 *   1. GroupSalaryRate группы — перекрывает ВСЕ личные ставки (версий не имеет).
 *   2. SalaryRate по направлению (исключение) → её версия, действующая на atDate.
 *   3. SalaryRate дефолтная → её версия, действующая на atDate.
 *   4. null — ставка не настроена, ЗП = 0.
 *
 * Версия выбирается pickRateAt: занятие всегда считается по ставке своего периода,
 * даже если отметить/переотметить его задним числом после смены ставки.
 */
export async function resolveRate(
  db: DB,
  input: ResolveRateInput,
  atDate: Date,
): Promise<ResolvedRate | null> {
  const groupRate = await db.groupSalaryRate.findUnique({
    where: { groupId: input.groupId },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })
  if (groupRate) return toResolved(groupRate, "group")

  const personalException = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: input.directionId,
    },
    include: withSchedules,
  })
  if (personalException) {
    const snap = pickRateAt(personalException, personalException.schedules, atDate)
    return toResolved(snap, "exception")
  }

  const personalDefault = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: null,
    },
    include: withSchedules,
  })
  if (personalDefault) {
    const snap = pickRateAt(personalDefault, personalDefault.schedules, atDate)
    return toResolved(snap, "default")
  }

  return null
}

/**
 * Режим оплаты пробного инструктору (trialPayMode) на дату atDate.
 * Приоритет (как у resolveRate):
 *   1. Ставка группы (GroupSalaryRate), если задана И режим указан явно
 *      (trialPayMode != null) — перекрывает личную. NULL = наследовать личную.
 *   2. Личная ставка по направлению (исключение) → её версия на atDate.
 *   3. Личная дефолтная ставка → её версия на atDate.
 *   4. "none".
 * trialPayMode входит в снимок версии — личную резолвим по дате так же, как ставку.
 * У ставки группы версий нет.
 */
export async function resolveTrialPayMode(
  db: DB,
  input: { tenantId: string; groupId?: string | null; employeeId: string; directionId: string | null },
  atDate: Date,
): Promise<string> {
  // Ставка группы перекрывает личную и для пробных — но только если режим задан
  // явно. trialPayMode = NULL (по умолчанию) означает «наследовать личную».
  if (input.groupId) {
    const groupRate = await db.groupSalaryRate.findUnique({
      where: { groupId: input.groupId },
      select: { trialPayMode: true },
    })
    if (groupRate?.trialPayMode != null) return groupRate.trialPayMode
  }

  const trialSchedules = {
    where: { deletedAt: null },
    orderBy: { effectiveFrom: "asc" as const },
    select: { trialPayMode: true, effectiveFrom: true, deletedAt: true },
  } as const

  if (input.directionId) {
    const exception = await db.salaryRate.findFirst({
      where: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        directionId: input.directionId,
      },
      select: { trialPayMode: true, schedules: trialSchedules },
    })
    if (exception) return pickRateAt(exception, exception.schedules, atDate).trialPayMode
  }

  const personalDefault = await db.salaryRate.findFirst({
    where: { tenantId: input.tenantId, employeeId: input.employeeId, directionId: null },
    select: { trialPayMode: true, schedules: trialSchedules },
  })
  return personalDefault
    ? pickRateAt(personalDefault, personalDefault.schedules, atDate).trialPayMode
    : "none"
}
