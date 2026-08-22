// Загрузка версий оклада (OkladSchedule) и резолв оклада за период.
//
// Оклад = базовая величина (Employee.monthlySalary + okladFrom) + версии «с даты
// оклад стал таким». Чистая арифметика — в oklad-for-period.ts; здесь только
// доступ к БД, чтобы у всех потребителей (ведомость, карточка, автозаполнение,
// прогноз, оклад-твин ОПИУ) был один источник и они не разъезжались.

import type { Prisma, PrismaClient } from "@prisma/client"
import { okladForPeriod, type OkladVersion } from "./oklad-for-period"

type DB = PrismaClient | Prisma.TransactionClient

/** Версии оклада по employeeId. Сотрудник без версий в карту не попадает. */
export async function loadOkladSchedules(
  db: DB,
  tenantId: string,
  employeeIds?: string[],
): Promise<Map<string, OkladVersion[]>> {
  const rows = await db.okladSchedule.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    select: { employeeId: true, effectiveFrom: true, amount: true },
    orderBy: { effectiveFrom: "asc" },
  })
  const map = new Map<string, OkladVersion[]>()
  for (const r of rows) {
    const list = map.get(r.employeeId) ?? []
    list.push({ effectiveFrom: r.effectiveFrom, amount: Number(r.amount) })
    map.set(r.employeeId, list)
  }
  return map
}

export interface OkladPeriodResolution {
  /** Сумма оклада за период (с учётом версий, даты начала и пропорции дней). */
  amount: number
  /** Окладник ли сотрудник В ЭТОМ периоде (amount > 0). */
  hasOklad: boolean
  defaultDirectionId: string | null
  okladBranchIds: string[]
}

/**
 * Оклад одного сотрудника за период — грузит и сотрудника, и его версии.
 * Для вызова внутри транзакции (оклад-твин ОПИУ): раньше сумму передавали снаружи
 * сырым Employee.monthlySalary, из-за чего признание расхода игнорировало okladFrom
 * и версии, а начисление их учитывало — начисление и ОПИУ расходились.
 */
export async function resolveOkladForPeriod(
  db: DB,
  input: { tenantId: string; employeeId: string; periodYear: number; periodMonth: number; upToDay?: number | null },
): Promise<OkladPeriodResolution> {
  const [employee, schedule] = await Promise.all([
    db.employee.findFirst({
      where: { id: input.employeeId, tenantId: input.tenantId },
      select: { monthlySalary: true, okladFrom: true, defaultDirectionId: true, okladBranchIds: true },
    }),
    db.okladSchedule.findMany({
      where: { tenantId: input.tenantId, employeeId: input.employeeId, deletedAt: null },
      select: { effectiveFrom: true, amount: true },
      orderBy: { effectiveFrom: "asc" },
    }),
  ])
  if (!employee) {
    return { amount: 0, hasOklad: false, defaultDirectionId: null, okladBranchIds: [] }
  }
  const amount = okladForPeriod({
    monthlySalary: employee.monthlySalary != null ? Number(employee.monthlySalary) : 0,
    okladFrom: employee.okladFrom,
    schedule: schedule.map((v) => ({ effectiveFrom: v.effectiveFrom, amount: Number(v.amount) })),
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
    upToDay: input.upToDay ?? null,
  })
  return {
    amount,
    hasOklad: amount > 0,
    defaultDirectionId: employee.defaultDirectionId,
    okladBranchIds: Array.isArray(employee.okladBranchIds) ? (employee.okladBranchIds as string[]) : [],
  }
}
