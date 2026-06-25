/**
 * Unit-тесты этапа 1 импорта базы (processLeads): привязка филиала.
 *  - колонка «Филиал» из 1С протаскивается в промежуточный файл;
 *  - пустой филиал считается в missingBranch;
 *  - дети одного телефона в разных филиалах → конфликт phone_has_multiple_branches.
 *
 * Чистая логика без БД (как branch-scope.test.ts): собираем входной xlsx в памяти,
 * прогоняем processLeads и читаем результат обратно через readSheet.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { processLeads, type ProcessResult } from "../lib/leads-import/process-leads"
import { readSheet } from "../lib/leads-import/parse-xlsx"

const HEADERS = ["ФИО", "Контактное лицо", "Телефон", "Состояние лида", "Филиал"]

function buildInput(rows: Record<string, string>[]): Buffer {
  const aoa = [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ""))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Лист_1")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("Импорт базы — этап 1: филиал", () => {
  it("колонка «Филиал» протаскивается в промежуточный файл, пустой → missingBranch", () => {
    const buf = buildInput([
      { "ФИО": "Иванов Иван", "Телефон": "+7 900 111-11-11", "Состояние лида": "Выбыл", "Филиал": "СОЦ" },
      { "ФИО": "Петров Петя", "Телефон": "+7 900 222-22-22", "Состояние лида": "Выбыл", "Филиал": "" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true, "конфликтов быть не должно")
    const ok = result as ProcessResult

    const out = readSheet(ok.fileBuffer, { headerRow: 0 })
    assert.ok("Филиал" in out[0], "в промежуточном файле есть колонка «Филиал»")

    const ivanov = out.find((r) => String(r["Ребёнок"]).startsWith("Иванов"))
    assert.ok(ivanov, "строка Иванова найдена")
    assert.equal(ivanov!["Филиал"], "СОЦ", "филиал Иванова = СОЦ")

    const petrov = out.find((r) => String(r["Ребёнок"]).startsWith("Петров"))
    assert.equal(petrov!["Филиал"], "", "у Петрова филиал пуст")
    assert.equal(ok.stats.missingBranch, 1, "ровно одна строка без филиала")
  })

  it("дети одного телефона в разных филиалах → конфликт phone_has_multiple_branches", () => {
    const buf = buildInput([
      { "ФИО": "Сидоров Коля", "Телефон": "+7 900 333-33-33", "Состояние лида": "Выбыл", "Филиал": "СОЦ" },
      { "ФИО": "Сидорова Оля", "Телефон": "+7 900 333-33-33", "Состояние лида": "Выбыл", "Филиал": "ONLINE" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, false, "должен быть конфликт")
    if (result.ok) return
    assert.ok(
      result.conflicts.some((c) => c.reason === "phone_has_multiple_branches"),
      "среди конфликтов есть «разные филиалы у одного телефона»",
    )
    assert.ok(
      result.conflicts.some((c) => c.branch === "СОЦ") &&
        result.conflicts.some((c) => c.branch === "ONLINE"),
      "оба филиала попали в проблемные строки",
    )
  })

  it("один филиал на телефоне (с пустыми строками) конфликтом НЕ считается", () => {
    const buf = buildInput([
      { "ФИО": "Кузнецов Лев", "Телефон": "+7 900 444-44-44", "Состояние лида": "Выбыл", "Филиал": "ОЛИМП" },
      { "ФИО": "Кузнецова Ая", "Телефон": "+7 900 444-44-44", "Состояние лида": "Выбыл", "Филиал": "" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true, "пустой филиал не конфликтует с заполненным")
  })
})
