/**
 * Нормализация телефона = логин ЛК родителя.
 * Российские номера сводятся к канону 7XXXXXXXXXX; нероссийские (партнёры не из РФ)
 * логином становятся «как есть» — только цифры входного значения.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { normalizePhone, formatPhone, phoneMatchKey } from "../lib/phone"

describe("normalizePhone: российские номера (обратная совместимость)", () => {
  it("10 цифр с 9 → 7XXXXXXXXXX", () => {
    assert.equal(normalizePhone("9991112233"), "79991112233")
  })

  it("«8 999…» → 7XXXXXXXXXX", () => {
    assert.equal(normalizePhone("89991112233"), "79991112233")
  })

  it("«+7 (999) 111-22-33» → 7XXXXXXXXXX", () => {
    assert.equal(normalizePhone("+7 (999) 111-22-33"), "79991112233")
  })

  it("канон уже 7XXXXXXXXXX — без изменений", () => {
    assert.equal(normalizePhone("79991112233"), "79991112233")
  })

  it("все российские записи одного номера дают один логин", () => {
    const forms = ["9991112233", "89991112233", "+7 999 111 22 33", "7-999-111-22-33"]
    const canon = forms.map((f) => normalizePhone(f))
    assert.deepEqual(new Set(canon), new Set(["79991112233"]))
  })
})

describe("normalizePhone: зарубежные номера (партнёры не из РФ)", () => {
  it("номер с кодом страны логином = его цифры", () => {
    assert.equal(normalizePhone("+375 29 111-22-33"), "375291112233")
  })

  it("любой набор цифр (казахстанский +7…) — детерминирован", () => {
    // 11 цифр, начинается с 7 — уходит в «канон» как есть, вход даст то же
    assert.equal(normalizePhone("+7 701 234 56 78"), "77012345678")
  })

  it("короткий зарубежный номер тоже принимается", () => {
    assert.equal(normalizePhone("+49 30 123456"), "4930123456")
  })

  it("выдача и вход дают один логин (детерминизм)", () => {
    // На карточке хранится «+375 29 111-22-33», родитель вводит те же цифры
    const issued = normalizePhone("+375 29 111-22-33")
    const typedAtLogin = normalizePhone("375291112233")
    assert.equal(issued, typedAtLogin)
  })
})

describe("normalizePhone: нет цифр — логин не выдаётся", () => {
  it("пусто/undefined/null → null", () => {
    assert.equal(normalizePhone(""), null)
    assert.equal(normalizePhone(undefined), null)
    assert.equal(normalizePhone(null), null)
  })

  it("строка без цифр → null", () => {
    assert.equal(normalizePhone("нет телефона"), null)
    assert.equal(normalizePhone("+++"), null)
  })
})

describe("phoneMatchKey: сравнение «это один и тот же номер»", () => {
  it("все формы одного номера дают один ключ (последние 10 цифр)", () => {
    const forms = [
      "+79278060278",
      "+7 (927) 806 02 78",
      "79278060278",
      "+89278060278",
      "8 927 806-02-78",
      "9278060278",
    ]
    const keys = forms.map((f) => phoneMatchKey(f))
    assert.deepEqual(new Set(keys), new Set(["9278060278"]))
  })

  it("форматированный номер с пробелами нормализуется (баг «111 111 1111»)", () => {
    assert.equal(phoneMatchKey("111 111 1111"), "1111111111")
    assert.equal(phoneMatchKey("1111111111"), "1111111111")
    // Обе записи одного «номера» → один ключ → дубль будет пойман.
    assert.equal(phoneMatchKey("111 111 1111"), phoneMatchKey("1111111111"))
  })

  it("разные номера — разные ключи", () => {
    assert.notEqual(phoneMatchKey("+79278060278"), phoneMatchKey("+79278060279"))
  })

  it("меньше 7 цифр → null (слишком коротко для совпадения)", () => {
    assert.equal(phoneMatchKey("12345"), null)
    assert.equal(phoneMatchKey(""), null)
    assert.equal(phoneMatchKey(null), null)
    assert.equal(phoneMatchKey(undefined), null)
  })
})

describe("formatPhone", () => {
  it("российский канон форматируется в +7 (…)", () => {
    assert.equal(formatPhone("79991112233"), "+7 (999) 111-22-33")
  })

  it("зарубежный логин показывается как есть", () => {
    assert.equal(formatPhone("375291112233"), "375291112233")
  })
})
