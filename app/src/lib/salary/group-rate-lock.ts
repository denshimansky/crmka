import { Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Ставку группы (GroupSalaryRate) можно задавать/менять/снимать только пока
 * группа реально не заработала. «Заработала» = есть хотя бы одна РЕАЛЬНАЯ отметка
 * посещения (Attendance.isPending=false, включая пробные) на любом занятии группы.
 *
 * Плейсхолдеры (isPending=true — ученик «Разовое» без отметки, сброшенные отметки)
 * не считаются: у них ещё нет фактической отметки.
 *
 * Причина замка: смена ставки группы НЕ пересчитывает уже начисленные
 * Attendance.instructorPayAmount — правка после отметок рассинхронизировала бы ЗП
 * (часть занятий по старой ставке, часть по новой). Проверяется и в UI, и в API.
 */
export async function isGroupRateLocked(
  db: DB,
  tenantId: string,
  groupId: string,
): Promise<boolean> {
  const started = await db.lesson.findFirst({
    where: { tenantId, groupId, attendances: { some: { isPending: false } } },
    select: { id: true },
  })
  return started !== null
}
