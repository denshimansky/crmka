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

export type WithdrawalMode = "immediate" | "scheduled"

export interface WithdrawalDateCheck {
  /** Текст ошибки (для 400) или null, если дата валидна. */
  error: string | null
  /** immediate — дата ≤ сегодня (немедленное отчисление); scheduled — дата в
   *  будущем в пределах периода (отложенное отчисление, Подход A). */
  mode: WithdrawalMode
}

/**
 * Проверка вручную указанной даты отчисления.
 *
 * Правила:
 *   — не раньше начала абонемента (startDate);
 *   — дата ≤ сегодня → `immediate` (немедленная сверка, прежнее поведение);
 *   — дата > сегодня → `scheduled` (отложенное отчисление), но не позже конца
 *     периода абонемента (`periodEnd`) — следующий месяц это уже отдельный
 *     абонемент. Для абонемента, чей период уже истёк, будущая дата всегда
 *     попадёт за periodEnd и будет отклонена.
 *
 * now/periodEnd передаются явно — для тестируемости. Сравнение по полночи UTC
 * (как @db.Date в схеме).
 */
export function validateWithdrawalDate(
  override: Date,
  startDate: Date,
  now: Date,
  periodEnd: Date,
): WithdrawalDateCheck {
  if (Number.isNaN(override.getTime())) {
    return { error: "Некорректная дата отчисления", mode: "immediate" }
  }
  if (override < startDate) {
    return { error: "Дата отчисления не может быть раньше начала абонемента", mode: "immediate" }
  }
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  if (override > todayUtc) {
    if (override > periodEnd) {
      return {
        error: "Дата отчисления не может быть позже конца периода абонемента",
        mode: "scheduled",
      }
    }
    return { error: null, mode: "scheduled" }
  }
  return { error: null, mode: "immediate" }
}

/**
 * Конец периода абонемента (полночь UTC) — верхняя граница даты отложенного
 * отчисления. Календарный: последний день месяца периода. Пакет: expiresAt.
 * Нет ни того, ни другого — далёкое будущее (не ограничиваем).
 */
export function subscriptionPeriodEnd(sub: {
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  expiresAt?: Date | null
}): Date {
  if (sub.endDate) {
    return new Date(Date.UTC(sub.endDate.getUTCFullYear(), sub.endDate.getUTCMonth(), sub.endDate.getUTCDate()))
  }
  if (sub.periodYear && sub.periodMonth) {
    // Date.UTC(year, monthIndex, 0): periodMonth 1-based → monthIndex=periodMonth
    // указывает на следующий месяц, день 0 = последний день месяца периода.
    return new Date(Date.UTC(sub.periodYear, sub.periodMonth, 0))
  }
  if (sub.expiresAt) {
    return new Date(Date.UTC(sub.expiresAt.getUTCFullYear(), sub.expiresAt.getUTCMonth(), sub.expiresAt.getUTCDate()))
  }
  return new Date(Date.UTC(9999, 0, 1))
}
