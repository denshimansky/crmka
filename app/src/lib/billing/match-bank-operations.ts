// Матчинг входящих платежей из выписки Т-Банк с неоплаченными SaaS-счетами.
// Чистая функция (юнит-тестируемая), порядок правил — от сильного к слабому:
//
// 1. Номер счёта в назначении платежа («N-MM») + совпавшая сумма.
//    Несколько номеров в одной платёжке — сумма должна равняться сумме счетов.
// 2. ИНН плательщика + сумма ровно одного счёта его организаций.
//    Несколько счетов с одинаковой суммой (у Премеленной 2 организации по
//    5000 ₽ на один ИНН) — парсим детерминированно, только если число
//    платежей с этой суммой равно числу счетов (платит одно лицо за свои
//    же организации). Иначе — на ручную разборку.
// 3. ИНН + сумма платежа равна сумме ВСЕХ незакрытых счетов этого ИНН
//    (одна платёжка 10 000 закрывает два счёта по 5 000).
// 4. Иначе — unmatched с причиной (частичная оплата/переплата не матчится).

import { extractInvoiceNumberTokens } from "./invoice-number"

export interface MatchableInvoice {
  id: string
  number: string
  amount: number
  organizationId: string
  orgInn: string | null
  createdAt: Date
}

export interface MatchableOperation {
  operationId: string
  date: Date | null
  amount: number
  payerInn: string | null
  paymentPurpose: string | null
}

export type MatchRule = "number" | "inn_amount" | "inn_pair" | "inn_total"

export interface OperationMatch {
  operation: MatchableOperation
  invoiceIds: string[]
  rule: MatchRule
}

export interface OperationUnmatched {
  operation: MatchableOperation
  reason: string
}

export interface MatchResult {
  matches: OperationMatch[]
  unmatched: OperationUnmatched[]
}

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005

export function matchBankOperations(
  operations: MatchableOperation[],
  invoices: MatchableInvoice[]
): MatchResult {
  const matches: OperationMatch[] = []
  const unmatched: OperationUnmatched[] = []

  const freeInvoices = new Set(invoices.map((i) => i.id))
  const takeInvoices = (ids: string[]) => ids.forEach((id) => freeInvoices.delete(id))

  const ops = [...operations].sort(
    (a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)
  )

  // --- Правило 1: номер счёта в назначении платежа ---
  const rest: MatchableOperation[] = []
  for (const op of ops) {
    const tokens = extractInvoiceNumberTokens(op.paymentPurpose)
    const referenced = invoices.filter(
      (i) => freeInvoices.has(i.id) && tokens.includes(i.number)
    )
    if (referenced.length === 0) {
      rest.push(op)
      continue
    }

    const total = referenced.reduce((s, i) => s + i.amount, 0)
    if (eq(total, op.amount)) {
      takeInvoices(referenced.map((i) => i.id))
      matches.push({ operation: op, invoiceIds: referenced.map((i) => i.id), rule: "number" })
    } else {
      // Номер указан, но сумма не сошлась — частичная оплата/переплата,
      // в счёт по ИНН не переносим (намерение плательщика явное)
      unmatched.push({
        operation: op,
        reason: `Назначение ссылается на счёт(а) №${referenced.map((i) => i.number).join(", ")} на ${total}, но сумма платежа ${op.amount}`,
      })
    }
  }

  // --- Правила 2–3: по ИНН плательщика ---
  // Счётчики пар (ИНН, сумма) для детерминированного парсинга равных сумм
  const opCountByInnAmount = new Map<string, number>()
  for (const op of rest) {
    if (!op.payerInn) continue
    const key = `${op.payerInn}|${op.amount}`
    opCountByInnAmount.set(key, (opCountByInnAmount.get(key) || 0) + 1)
  }

  for (const op of rest) {
    if (!op.payerInn) {
      unmatched.push({ operation: op, reason: "У платежа нет ИНН плательщика" })
      continue
    }

    const candidates = invoices.filter(
      (i) => freeInvoices.has(i.id) && i.orgInn === op.payerInn
    )
    if (candidates.length === 0) {
      unmatched.push({
        operation: op,
        reason: `Нет неоплаченных счетов для ИНН ${op.payerInn} (или уже закрыты этим прогоном)`,
      })
      continue
    }

    const exact = candidates
      .filter((i) => eq(i.amount, op.amount))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    if (exact.length === 1) {
      takeInvoices([exact[0].id])
      matches.push({ operation: op, invoiceIds: [exact[0].id], rule: "inn_amount" })
      continue
    }

    if (exact.length > 1) {
      // Одинаковые суммы: парсим только при равенстве числа платежей и счетов
      const key = `${op.payerInn}|${op.amount}`
      if (opCountByInnAmount.get(key) === exact.length) {
        // Платежи обрабатываются по дате, счета берём по дате создания —
        // детерминированная пара «первый платёж → первый счёт»
        takeInvoices([exact[0].id])
        matches.push({ operation: op, invoiceIds: [exact[0].id], rule: "inn_pair" })
      } else {
        unmatched.push({
          operation: op,
          reason: `Несколько счетов на ${op.amount} для ИНН ${op.payerInn} (${exact.map((i) => i.number).join(", ")}) — число платежей не совпадает с числом счетов`,
        })
      }
      continue
    }

    // Одна платёжка закрывает все счета этого ИНН целиком
    const total = candidates.reduce((s, i) => s + i.amount, 0)
    if (candidates.length > 1 && eq(total, op.amount)) {
      takeInvoices(candidates.map((i) => i.id))
      matches.push({
        operation: op,
        invoiceIds: candidates.map((i) => i.id),
        rule: "inn_total",
      })
      continue
    }

    unmatched.push({
      operation: op,
      reason: `Сумма ${op.amount} не совпадает ни с одним счётом ИНН ${op.payerInn} (${candidates.map((i) => `№${i.number}=${i.amount}`).join(", ")}) и не равна их сумме ${total}`,
    })
  }

  return { matches, unmatched }
}
