// Нумерация счетов-договоров оферты: «{seq}-{MM}» (образец: «1-06»).
// seq — сквозной глобальный счётчик по всем счетам нового формата (не
// сбрасывается по месяцам/годам — иначе unique по number ломался бы через год),
// MM — месяц начала оплачиваемого периода. Старые номера (INV-YYYYMM-XXX,
// 000001) под формат не подпадают и в счётчике не участвуют.

import { db } from "@/lib/db"

/** Строгий формат номера нового образца */
export const INVOICE_NUMBER_RE = /^\d{1,6}-\d{2}$/

/** Токены, похожие на номер счёта, в назначении платежа */
const PURPOSE_TOKEN_RE = /\d{1,6}-\d{2}/g

export function formatInvoiceNumber(seq: number, periodStart: Date): string {
  const mm = String(periodStart.getUTCMonth() + 1).padStart(2, "0")
  return `${seq}-${mm}`
}

/**
 * Следующий номер счёта. Гонка двух параллельных вызовов разрешается
 * unique-констрейнтом на billing_invoices.number — вызывающий обязан
 * ретраить создание счёта при P2002 (см. createInvoiceWithNumber).
 *
 * Счётчик монотонный и с учётом УДАЛЁННЫХ счетов: удаление строки из
 * billing_invoices (админское «Удалить счёт») иначе освободило бы номер, и
 * новый документ вышел бы под номером, который партнёр уже видел в PDF.
 * След удаления лежит в audit_logs (entity_type = BillingInvoice, delete).
 */
export async function nextInvoiceNumber(periodStart: Date): Promise<string> {
  const rows = await db.$queryRaw<{ max: number | null }[]>`
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(split_part(number, '-', 1)::int)
        FROM billing_invoices
        WHERE number ~ '^[0-9]{1,6}-[0-9]{2}$'
      ), 0),
      COALESCE((
        SELECT MAX(split_part(changes->>'number', '-', 1)::int)
        FROM audit_logs
        WHERE entity_type = 'BillingInvoice'
          AND action = 'delete'
          AND changes->>'number' ~ '^[0-9]{1,6}-[0-9]{2}$'
      ), 0)
    ) AS max
  `
  const seq = (rows[0]?.max ?? 0) + 1
  return formatInvoiceNumber(seq, periodStart)
}

/**
 * Уникальные токены вида «N-MM» из назначения платежа.
 * Матчинг оплаты считает токен номером счёта только если он совпал
 * с номером реального pending-счёта И сумма сошлась (защита от дат
 * вроде «01-07» в тексте назначения).
 */
export function extractInvoiceNumberTokens(purpose: string | null | undefined): string[] {
  if (!purpose) return []
  const tokens = purpose.match(PURPOSE_TOKEN_RE) || []
  return [...new Set(tokens)]
}
