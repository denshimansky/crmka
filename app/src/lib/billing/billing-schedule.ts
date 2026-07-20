// Движок дат индивидуального SaaS-биллинга (Bug #65).
//
// Новый партнёр получает 14 дней теста; счёт выставляется за 10 дней до срока
// оплаты (= на 4-й день теста), срок оплаты первого счёта = конец теста. Далее
// каждый месяц — «день-якорь» (день месяца от даты старта + 14). Дни 29/30/31
// переносятся на последний день коротких месяцев БЕЗ дрейфа: день якоря всегда
// берётся из хранимого billingAnchorDay, а НЕ из дня уже сдвинутой даты (иначе
// 28 фев + 1 мес → 28 мар и якорь 31 теряется навсегда).
//
// Всё в UTC; входные/выходные Date — полуночь UTC соответствующего дня.

export const TRIAL_DAYS = Number(process.env.BILLING_TRIAL_DAYS) || 14
export const INVOICE_LEAD_DAYS = Number(process.env.BILLING_INVOICE_LEAD_DAYS) || 10

const DAY_MS = 24 * 60 * 60 * 1000

/** Кол-во дней в месяце (monthIndex 0–11; допускается 12+ — год катится сам). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Дата-полночь UTC от произвольного Date (усечение времени). */
export function toUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Срок оплаты в конкретном месяце: min(anchorDay, дней в месяце).
 * monthIndex может быть 12+ (перенос года через Date.UTC).
 */
export function dueDateForMonth(anchorDay: number, year: number, monthIndex: number): Date {
  const dim = daysInMonth(year, monthIndex)
  const day = Math.min(anchorDay, dim)
  return new Date(Date.UTC(year, monthIndex, day))
}

/**
 * Следующий срок оплаты через n месяцев от currentDue.
 * КЛЮЧЕВОЕ: день берётся из anchorDay, месяц — из currentDue (+n). День самой
 * currentDue не читается, поэтому клампинг коротких месяцев не даёт дрейфа.
 */
export function nextDueDate(currentDue: Date, anchorDay: number, n = 1): Date {
  return dueDateForMonth(anchorDay, currentDue.getUTCFullYear(), currentDue.getUTCMonth() + n)
}

/**
 * Последний день оплаченного периода: день перед следующим сроком оплаты.
 * periodMonths учитывает подписки на 1/3/6/12 мес.
 */
export function periodEndForAnchor(due: Date, anchorDay: number, periodMonths: number): Date {
  const next = nextDueDate(due, anchorDay, Math.max(1, periodMonths))
  return new Date(next.getTime() - DAY_MS)
}

/** Конец теста = дата старта + TRIAL_DAYS (полночь UTC). */
export function trialEndFromStart(start: Date): Date {
  return new Date(toUtcDate(start).getTime() + TRIAL_DAYS * DAY_MS)
}

/** День-якорь = день месяца конца теста (1–31). */
export function anchorDayFromTrialEnd(trialEnd: Date): number {
  return trialEnd.getUTCDate()
}

/**
 * Пора ли выставлять anchored-счёт: сегодня не раньше, чем за INVOICE_LEAD_DAYS
 * до срока оплаты. Работает и после срока (просрочка/дозапуск).
 */
export function shouldIssueAnchored(now: Date, due: Date): boolean {
  const issueFrom = new Date(due.getTime() - INVOICE_LEAD_DAYS * DAY_MS)
  return toUtcDate(now).getTime() >= issueFrom.getTime()
}

export type InvoiceIdempotencyStatus = "pending" | "paid" | "overdue"

export interface InvoicePlan {
  periodStart: Date
  periodEnd: Date
  dueDate: Date
  /** Статусы уже существующих счетов, подавляющие повторное выставление */
  idempotencyStatuses: InvoiceIdempotencyStatus[]
  /** legacy: nextPaymentDate в прошлом периоде (долг) — для debtWarning */
  isPastDuePeriod: boolean
}

/**
 * Решение о выставлении счёта для подписки на дату `now`. null = сейчас не
 * выставляем (не тот день / рано / оплачено вперёд). Чистая функция без БД —
 * основная точка юнит-тестов логики генерации (Bug #65).
 *
 *  • LEGACY (billingAnchorDay = null): счёт на 1-е число следующего месяца,
 *    только с 20-го; идемпотентность pending/paid (periodStart двигается сам).
 *  • ANCHORED: срок = nextPaymentDate (день-якорь), счёт за 10 дней до срока;
 *    идемпотентность включает overdue (nextPaymentDate двигается лишь при оплате,
 *    иначе после блокировки плодился бы дубль периода).
 */
export function planInvoice(
  sub: {
    billingAnchorDay: number | null
    nextPaymentDate: Date
    billingPeriodMonths: number | null
  },
  now: Date
): InvoicePlan | null {
  const periodMonths = Math.max(1, sub.billingPeriodMonths || 1)
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  if (sub.billingAnchorDay == null) {
    if (now.getUTCDate() < 20) return null
    if (sub.nextPaymentDate > nextMonthStart) return null
    return {
      periodStart: nextMonthStart,
      dueDate: nextMonthStart,
      periodEnd: new Date(
        Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + periodMonths, 0)
      ),
      idempotencyStatuses: ["pending", "paid"],
      isPastDuePeriod: sub.nextPaymentDate < currentMonthStart,
    }
  }

  if (!shouldIssueAnchored(now, sub.nextPaymentDate)) return null
  return {
    periodStart: sub.nextPaymentDate,
    dueDate: sub.nextPaymentDate,
    periodEnd: periodEndForAnchor(sub.nextPaymentDate, sub.billingAnchorDay, periodMonths),
    idempotencyStatuses: ["pending", "paid", "overdue"],
    isPastDuePeriod: false,
  }
}
