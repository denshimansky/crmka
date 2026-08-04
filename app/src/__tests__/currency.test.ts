/**
 * Валюта расчёта — отображение символа/формата без пересчёта по курсу.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencySymbol,
  formatMoney,
  isSupportedCurrency,
} from "../lib/currency"

describe("currency: список и символы", () => {
  it("дефолт — рубль РФ, идёт первым", () => {
    assert.equal(DEFAULT_CURRENCY, "RUB")
    assert.equal(CURRENCIES[0].code, "RUB")
    assert.equal(currencySymbol("RUB"), "₽")
  })

  it("поддержаны популярные валюты СНГ", () => {
    for (const code of ["RUB", "KZT", "BYN", "UAH", "UZS", "KGS", "AZN", "AMD", "GEL"]) {
      assert.ok(isSupportedCurrency(code), `${code} должна поддерживаться`)
    }
  })

  it("неизвестный/пустой код → символ рубля (без падения)", () => {
    assert.equal(isSupportedCurrency("XXX"), false)
    assert.equal(isSupportedCurrency(null), false)
    assert.equal(currencySymbol("XXX"), "₽")
    assert.equal(currencySymbol(null), "₽")
    assert.equal(currencySymbol(undefined), "₽")
  })
})

describe("currency: formatMoney", () => {
  // Intl ru-RU разделяет тысячи неразрывным пробелом — нормализуем любые пробелы
  // к обычному (тот же формат, что во всех formatMoney приложения).
  const norm = (s: string) => s.replace(/\s/g, " ")

  it("по умолчанию — копейки только когда есть, символ валюты организации", () => {
    // Целое — без копеек.
    assert.equal(norm(formatMoney(1000, "RUB")), "1 000 ₽")
    assert.equal(norm(formatMoney(0, "UAH")), "0 ₴")
    // Дробное — копейки показываются, лишние нули отсекаются (не «врём» округлением).
    assert.equal(norm(formatMoney(4203.5, "RUB")), "4 203,5 ₽")
    assert.equal(norm(formatMoney(1234.56, "KZT")), "1 234,56 ₸")
    // Float-мусор гасится округлением до копеек.
    assert.equal(norm(formatMoney(2827.499999, "RUB")), "2 827,5 ₽")
  })

  it("decimals — фиксированное число знаков", () => {
    assert.equal(norm(formatMoney(1234.5, "RUB", { decimals: 2 })), "1 234,50 ₽")
    // decimals: 0 — принудительное округление до целого.
    assert.equal(norm(formatMoney(1234.56, "RUB", { decimals: 0 })), "1 235 ₽")
  })

  it("без валюты — рубль (совместимость с текущими организациями)", () => {
    assert.equal(norm(formatMoney(500)), "500 ₽")
  })
})
