/**
 * Unit-тесты матчинга входящих платежей выписки Т-Банк с SaaS-счетами
 * (lib/billing/match-bank-operations.ts). Ключевые кейсы:
 * номер счёта в назначении, ИНН+сумма, две организации на один ИНН
 * с одинаковыми суммами (Премеленная), одна платёжка за все счета,
 * частичная оплата/переплата → unmatched.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  matchBankOperations,
  MatchableInvoice,
  MatchableOperation,
} from "../lib/billing/match-bank-operations"

const inv = (o: Partial<MatchableInvoice> & { id: string }): MatchableInvoice => ({
  number: "1-08",
  amount: 5000,
  organizationId: "org-" + o.id,
  orgInn: "500100200300",
  createdAt: new Date("2026-07-20T00:00:00Z"),
  ...o,
})

const op = (o: Partial<MatchableOperation> & { operationId: string }): MatchableOperation => ({
  date: new Date("2026-07-25T10:00:00Z"),
  amount: 5000,
  payerInn: "500100200300",
  paymentPurpose: null,
  ...o,
})

describe("правило 1: номер счёта в назначении", () => {
  it("номер + совпавшая сумма → match", () => {
    const { matches, unmatched } = matchBankOperations(
      [op({ operationId: "op1", paymentPurpose: "Оплата по счету-договору оферты №1-08", amount: 12500 })],
      [inv({ id: "i1", number: "1-08", amount: 12500 })]
    )
    assert.equal(unmatched.length, 0)
    assert.equal(matches.length, 1)
    assert.deepEqual(matches[0].invoiceIds, ["i1"])
    assert.equal(matches[0].rule, "number")
  })

  it("номер указан, но сумма не сошлась (частичная оплата) → unmatched", () => {
    const { matches, unmatched } = matchBankOperations(
      [op({ operationId: "op1", paymentPurpose: "Оплата №1-08", amount: 6000 })],
      [inv({ id: "i1", number: "1-08", amount: 12500 })]
    )
    assert.equal(matches.length, 0)
    assert.equal(unmatched.length, 1)
    assert.match(unmatched[0].reason, /сумма платежа 6000/)
  })

  it("два номера в одной платёжке, сумма = сумме счетов → оба закрыты", () => {
    const { matches } = matchBankOperations(
      [op({ operationId: "op1", paymentPurpose: "Счета №1-08 и №2-08", amount: 14000 })],
      [
        inv({ id: "i1", number: "1-08", amount: 5000 }),
        inv({ id: "i2", number: "2-08", amount: 9000 }),
      ]
    )
    assert.equal(matches.length, 1)
    assert.deepEqual(new Set(matches[0].invoiceIds), new Set(["i1", "i2"]))
  })

  it("токен-дата в назначении («01-07») не совпадает ни с одним счётом → идём по ИНН", () => {
    const { matches } = matchBankOperations(
      [op({ operationId: "op1", paymentPurpose: "Оплата за услуги 01-07", amount: 5000 })],
      [inv({ id: "i1", number: "3-08", amount: 5000 })]
    )
    assert.equal(matches.length, 1)
    assert.equal(matches[0].rule, "inn_amount")
  })
})

describe("правило 2: ИНН + сумма", () => {
  it("единственный счёт с точной суммой → match", () => {
    const { matches } = matchBankOperations(
      [op({ operationId: "op1", amount: 9000 })],
      [
        inv({ id: "i1", amount: 9000 }),
        inv({ id: "i2", amount: 5000 }),
      ]
    )
    assert.equal(matches.length, 1)
    assert.deepEqual(matches[0].invoiceIds, ["i1"])
    assert.equal(matches[0].rule, "inn_amount")
  })

  it("Премеленная: 2 счёта по 5000 на один ИНН, 2 платёжки по 5000 → оба спарены", () => {
    const { matches, unmatched } = matchBankOperations(
      [
        op({ operationId: "op1", date: new Date("2026-07-25T10:00:00Z") }),
        op({ operationId: "op2", date: new Date("2026-07-26T10:00:00Z") }),
      ],
      [
        inv({ id: "i1", number: "1-08", createdAt: new Date("2026-07-20T00:00:00Z") }),
        inv({ id: "i2", number: "2-08", createdAt: new Date("2026-07-20T00:01:00Z") }),
      ]
    )
    assert.equal(unmatched.length, 0)
    assert.equal(matches.length, 2)
    // Детерминированное парование: первый платёж → первый счёт.
    // Второму платежу остаётся единственный кандидат → правило inn_amount.
    assert.deepEqual(matches[0].invoiceIds, ["i1"])
    assert.deepEqual(matches[1].invoiceIds, ["i2"])
    assert.equal(matches[0].rule, "inn_pair")
    assert.equal(matches[1].rule, "inn_amount")
  })

  it("2 счёта по 5000, ОДНА платёжка 5000 → unmatched (неоднозначно)", () => {
    const { matches, unmatched } = matchBankOperations(
      [op({ operationId: "op1" })],
      [
        inv({ id: "i1", number: "1-08" }),
        inv({ id: "i2", number: "2-08" }),
      ]
    )
    assert.equal(matches.length, 0)
    assert.equal(unmatched.length, 1)
    assert.match(unmatched[0].reason, /Несколько счетов/)
  })
})

describe("правило 3: одна платёжка за все счета ИНН", () => {
  it("платёжка 10000 закрывает два счёта по 5000", () => {
    const { matches, unmatched } = matchBankOperations(
      [op({ operationId: "op1", amount: 10000 })],
      [
        inv({ id: "i1", number: "1-08" }),
        inv({ id: "i2", number: "2-08" }),
      ]
    )
    assert.equal(unmatched.length, 0)
    assert.equal(matches.length, 1)
    assert.deepEqual(new Set(matches[0].invoiceIds), new Set(["i1", "i2"]))
    assert.equal(matches[0].rule, "inn_total")
  })
})

describe("unmatched-случаи", () => {
  it("нет ИНН плательщика и номера → unmatched", () => {
    const { unmatched } = matchBankOperations(
      [op({ operationId: "op1", payerInn: null })],
      [inv({ id: "i1" })]
    )
    assert.equal(unmatched.length, 1)
    assert.match(unmatched[0].reason, /нет ИНН/i)
  })

  it("неизвестный ИНН → unmatched", () => {
    const { unmatched } = matchBankOperations(
      [op({ operationId: "op1", payerInn: "999999999999" })],
      [inv({ id: "i1" })]
    )
    assert.equal(unmatched.length, 1)
  })

  it("переплата без номера счёта → unmatched", () => {
    const { matches, unmatched } = matchBankOperations(
      [op({ operationId: "op1", amount: 7777 })],
      [inv({ id: "i1", amount: 5000 })]
    )
    assert.equal(matches.length, 0)
    assert.equal(unmatched.length, 1)
    assert.match(unmatched[0].reason, /не совпадает/)
  })
})
