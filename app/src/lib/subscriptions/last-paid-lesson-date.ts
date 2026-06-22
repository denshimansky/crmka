// Дата последнего ПЛАТНОГО занятия абонемента — основа правила отчисления.
//
// Правило (запрошено заказчиком): при отчислении абонемента дата отчисления =
// дата последнего платного занятия. «Платное» = любая отметка (Вид дня), где
// было реальное списание денег с абонемента (Attendance.chargeAmount > 0),
// ДАЖЕ если баланс абонемента ушёл в минус (ребёнок пришёл на платное, а денег
// на абонементе нет — списание всё равно записано). Пробные и pending-заглушки
// имеют chargeAmount = 0 и сюда НЕ попадают.
//
// После даты отчисления ученик не должен отображаться в составе группы. Это
// обеспечивается выставлением GroupEnrollment.withdrawnAt = D + 1 день (фильтр
// состава — withdrawnAt > дата занятия, исключающая граница: занятие в день D
// показывается, всё что позже — нет). См. nextDayUtc ниже.

import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Возвращает дату (полночь UTC, @db.Date) последнего платного занятия абонемента
 * или null, если платных посещений (chargeAmount > 0) нет.
 */
export async function getLastPaidLessonDate(
  tx: Tx,
  tenantId: string,
  subscriptionId: string,
): Promise<Date | null> {
  const last = await tx.attendance.findFirst({
    where: {
      tenantId,
      subscriptionId,
      // > 0: любое реальное списание с абонемента. Минус баланса абонемента на
      // сам факт списания не влияет — chargeAmount всё равно положительный.
      chargeAmount: { gt: 0 },
    },
    orderBy: { lesson: { date: "desc" } },
    select: { lesson: { select: { date: true } } },
  })
  return last?.lesson.date ?? null
}

/**
 * Следующий календарный день (полночь UTC). Используется для GroupEnrollment.
 * withdrawnAt: при дате отчисления D ставим withdrawnAt = D+1, чтобы занятие в
 * день D осталось в составе, а более поздние — выпали (фильтр withdrawnAt > date).
 * Date.UTC корректно переносит границу месяца/года.
 */
export function nextDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
}

/**
 * Проверка вручную указанной даты отчисления. Возвращает текст ошибки (для 400)
 * или null, если дата валидна. Правила: дата не в будущем (последнее платное
 * занятие не может быть в будущем) и не раньше начала абонемента. now передаётся
 * явно — для тестируемости. Сравнение по полночи UTC (как @db.Date в схеме).
 */
export function validateWithdrawalDate(
  override: Date,
  startDate: Date,
  now: Date,
): string | null {
  if (Number.isNaN(override.getTime())) return "Некорректная дата отчисления"
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  if (override > todayUtc) return "Дата отчисления не может быть в будущем"
  if (override < startDate) return "Дата отчисления не может быть раньше начала абонемента"
  return null
}
