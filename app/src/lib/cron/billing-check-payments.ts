// Проверка оплаты SaaS-счетов по выписке Т-Банк (каждые 2 часа).
//
// Тянем входящие операции за rolling-окно 7 дней, отбрасываем уже
// обработанные (billing_bank_operations.operation_id — идемпотентность),
// матчим с неоплаченными счетами (pending + overdue — оплата после
// блокировки тоже должна разблокировать) и применяем оплату общим
// хелпером applyInvoicePayment (продление подписки, разблокировка,
// удаление уведомлений «оплатите счёт»).
//
// В таблицу операций пишем только «релевантные» несматченные платежи
// (ИНН плательщика принадлежит организации с незакрытым счётом или в
// назначении упомянут номер счета) — прочие поступления ИП к CRM
// отношения не имеют и не фиксируются.

import { db } from "@/lib/db"
import { getTBankClient, TBankStatementOperation } from "@/lib/tbank"
import { EXECUTOR } from "@/lib/billing/requisites"
import { applyInvoicePayment } from "@/lib/billing/apply-invoice-payment"
import { extractInvoiceNumberTokens } from "@/lib/billing/invoice-number"
import {
  matchBankOperations,
  MatchableInvoice,
  MatchableOperation,
} from "@/lib/billing/match-bank-operations"

const fmtDay = (d: Date) => d.toISOString().slice(0, 10)

export interface CheckPaymentsResult {
  /** Крон не сконфигурирован (нет токена/счёта) — не ошибка */
  skipped?: string
  invoicesOpen: number
  operationsSeen: number
  matched: number
  invoicesPaid: number
  unmatched: number
}

export async function checkBillingPayments(now: Date = new Date()): Promise<CheckPaymentsResult> {
  const empty: CheckPaymentsResult = {
    invoicesOpen: 0,
    operationsSeen: 0,
    matched: 0,
    invoicesPaid: 0,
    unmatched: 0,
  }

  const token = process.env.TBANK_API_TOKEN
  const account = process.env.TBANK_ACCOUNT_NUMBER
  if (!token || !account) {
    return { ...empty, skipped: "TBANK_API_TOKEN / TBANK_ACCOUNT_NUMBER не заданы" }
  }

  // Незакрытые счета (pending + overdue) не-exempt организаций
  const openInvoices = await db.billingInvoice.findMany({
    where: { status: { in: ["pending", "overdue"] } },
    include: { organization: { select: { inn: true, billingExempt: true } } },
  })
  const matchable: MatchableInvoice[] = openInvoices
    .filter((i) => !i.organization.billingExempt)
    .map((i) => ({
      id: i.id,
      number: i.number,
      amount: Number(i.amount),
      organizationId: i.organizationId,
      orgInn: i.organization.inn?.trim() || null,
      createdAt: i.createdAt,
    }))
  if (matchable.length === 0) return empty
  empty.invoicesOpen = matchable.length

  // Выписка за rolling-окно 7 дней (перекрытие безопасно — идемпотентность по operationId)
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const client = getTBankClient()
  const operations = await client.getStatementOperations({
    accountNumber: account,
    from: fmtDay(from),
    till: fmtDay(now),
  })
  empty.operationsSeen = operations.length

  // Только входящие и не от самого исполнителя
  const knownInns = new Set(matchable.map((i) => i.orgInn).filter(Boolean) as string[])
  const knownNumbers = new Set(matchable.map((i) => i.number))
  const relevant = operations.filter((op) => {
    if (!op.isCredit || op.payerInn === EXECUTOR.inn) return false
    if (op.payerInn && knownInns.has(op.payerInn)) return true
    return extractInvoiceNumberTokens(op.paymentPurpose).some((t) => knownNumbers.has(t))
  })
  if (relevant.length === 0) return empty

  // Идемпотентность: уже обработанные операции пропускаем
  const seen = await db.billingBankOperation.findMany({
    where: { operationId: { in: relevant.map((o) => o.operationId) } },
    select: { operationId: true },
  })
  const seenIds = new Set(seen.map((s) => s.operationId))
  const fresh = relevant.filter((o) => !seenIds.has(o.operationId))
  if (fresh.length === 0) return empty

  const toMatchable = (op: TBankStatementOperation): MatchableOperation => ({
    operationId: op.operationId,
    date: op.date,
    amount: op.amount,
    payerInn: op.payerInn,
    paymentPurpose: op.paymentPurpose,
  })

  const rawById = new Map(fresh.map((o) => [o.operationId, o]))
  const { matches, unmatched } = matchBankOperations(fresh.map(toMatchable), matchable)

  for (const m of matches) {
    const rawOp = rawById.get(m.operation.operationId)
    await db.$transaction(async (tx) => {
      for (const invoiceId of m.invoiceIds) {
        await applyInvoicePayment(tx, {
          invoiceId,
          paidVia: "bank_transfer",
          paidAt: m.operation.date ?? now,
          // Сумму каждого счёта считаем оплаченной целиком (правила матчинга
          // гарантируют равенство сумм)
          comment: `Оплачен по выписке Т-Банк, операция ${m.operation.operationId} от ${m.operation.date ? fmtDay(m.operation.date) : "?"}`,
        })
      }
      await tx.billingBankOperation.create({
        data: {
          operationId: m.operation.operationId,
          operationDate: m.operation.date ?? now,
          amount: m.operation.amount,
          payerName: rawOp?.payerName ?? null,
          payerInn: m.operation.payerInn,
          paymentPurpose: m.operation.paymentPurpose,
          status: "matched",
          matchedInvoiceIds: m.invoiceIds,
          comment: `Правило: ${m.rule}`,
          raw: (rawOp?.raw ?? undefined) as object | undefined,
        },
      })
    })
    empty.matched++
    empty.invoicesPaid += m.invoiceIds.length
  }

  for (const u of unmatched) {
    const rawOp = rawById.get(u.operation.operationId)
    await db.billingBankOperation.create({
      data: {
        operationId: u.operation.operationId,
        operationDate: u.operation.date ?? now,
        amount: u.operation.amount,
        payerName: rawOp?.payerName ?? null,
        payerInn: u.operation.payerInn,
        paymentPurpose: u.operation.paymentPurpose,
        status: "unmatched",
        comment: u.reason,
        raw: (rawOp?.raw ?? undefined) as object | undefined,
      },
    })
    empty.unmatched++
  }

  return empty
}
