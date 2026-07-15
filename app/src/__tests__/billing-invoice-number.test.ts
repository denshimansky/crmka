/**
 * Unit-тесты нумерации SaaS-счетов «{seq}-{MM}» (образец «1-06»)
 * и извлечения номеров из назначения платежа (для матчинга выписки).
 * Чистая логика без БД (nextInvoiceNumber с $queryRaw здесь не гоняем).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  formatInvoiceNumber,
  extractInvoiceNumberTokens,
  INVOICE_NUMBER_RE,
} from "../lib/billing/invoice-number"

describe("formatInvoiceNumber", () => {
  it("формирует номер {seq}-{MM} по месяцу начала периода (UTC)", () => {
    assert.equal(formatInvoiceNumber(1, new Date(Date.UTC(2026, 5, 1))), "1-06")
    assert.equal(formatInvoiceNumber(42, new Date(Date.UTC(2026, 7, 1))), "42-08")
    assert.equal(formatInvoiceNumber(100, new Date(Date.UTC(2026, 11, 1))), "100-12")
  })
})

describe("INVOICE_NUMBER_RE", () => {
  it("принимает номера нового формата", () => {
    for (const n of ["1-06", "42-08", "123456-12"]) {
      assert.ok(INVOICE_NUMBER_RE.test(n), n)
    }
  })

  it("отвергает старые форматы и мусор", () => {
    for (const n of ["INV-202601-001", "000001", "1-6", "1-123", "-06", "1-", "a1-06"]) {
      assert.ok(!INVOICE_NUMBER_RE.test(n), n)
    }
  })
})

describe("extractInvoiceNumberTokens", () => {
  it("находит номер в типовом назначении платежа", () => {
    assert.deepEqual(
      extractInvoiceNumberTokens("Оплата по счету-договору оферты №7-08"),
      ["7-08"]
    )
  })

  it("находит несколько номеров и дедуплицирует", () => {
    assert.deepEqual(
      extractInvoiceNumberTokens("Оплата счетов 5-08, 6-08 и повторно 5-08"),
      ["5-08", "6-08"]
    )
  })

  it("пустое/отсутствующее назначение — пустой список", () => {
    assert.deepEqual(extractInvoiceNumberTokens(null), [])
    assert.deepEqual(extractInvoiceNumberTokens(undefined), [])
    assert.deepEqual(extractInvoiceNumberTokens("  "), [])
  })

  it("даты в назначении дают ложные токены — их отсеет проверка по номерам счетов", () => {
    // «01-07» похоже на номер: матчер считает токен номером только если
    // он совпал с номером реального счёта И сумма сошлась
    assert.deepEqual(extractInvoiceNumberTokens("Оплата за услуги 01-07"), ["01-07"])
  })
})
