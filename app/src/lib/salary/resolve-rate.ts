import { Prisma, type PrismaClient, type SalaryScheme } from "@prisma/client"

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

/**
 * Резолвит, по какой ставке считать ЗП педагогу за конкретное занятие.
 *
 * Приоритет (по требованию владельца):
 *   1. GroupSalaryRate группы — если задана, перекрывает ВСЕ личные ставки,
 *      включая замещающего инструктора.
 *   2. SalaryRate педагога с конкретным directionId — исключение по направлению.
 *   3. SalaryRate педагога без directionId — дефолтная ставка.
 *   4. null — у педагога ставка не настроена, ЗП за это занятие = 0.
 */
export async function resolveRate(
  db: DB,
  input: ResolveRateInput,
): Promise<ResolvedRate | null> {
  const groupRate = await db.groupSalaryRate.findUnique({
    where: { groupId: input.groupId },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })
  if (groupRate) {
    return {
      scheme: groupRate.scheme,
      ratePerStudent: groupRate.ratePerStudent,
      ratePerLesson: groupRate.ratePerLesson,
      fixedPerShift: groupRate.fixedPerShift,
      percentOfPayments: groupRate.percentOfPayments,
      brackets: groupRate.brackets.map((b) => ({
        minStudents: b.minStudents,
        ratePerLesson: b.ratePerLesson,
      })),
      source: "group",
    }
  }

  const personalException = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: input.directionId,
    },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })
  if (personalException) {
    return {
      scheme: personalException.scheme,
      ratePerStudent: personalException.ratePerStudent,
      ratePerLesson: personalException.ratePerLesson,
      fixedPerShift: personalException.fixedPerShift,
      percentOfPayments: personalException.percentOfPayments,
      brackets: personalException.brackets.map((b) => ({
        minStudents: b.minStudents,
        ratePerLesson: b.ratePerLesson,
      })),
      source: "exception",
    }
  }

  const personalDefault = await db.salaryRate.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      directionId: null,
    },
    include: { brackets: { orderBy: { minStudents: "asc" } } },
  })
  if (personalDefault) {
    return {
      scheme: personalDefault.scheme,
      ratePerStudent: personalDefault.ratePerStudent,
      ratePerLesson: personalDefault.ratePerLesson,
      fixedPerShift: personalDefault.fixedPerShift,
      percentOfPayments: personalDefault.percentOfPayments,
      brackets: personalDefault.brackets.map((b) => ({
        minStudents: b.minStudents,
        ratePerLesson: b.ratePerLesson,
      })),
      source: "default",
    }
  }

  return null
}
