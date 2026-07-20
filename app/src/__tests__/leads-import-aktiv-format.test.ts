/**
 * Unit-тесты этапа 1 импорта базы (processLeads): формат выгрузки «Актив».
 *  - шапка на первой строке, статус в колонке «Актив» (не «Состояние лида»);
 *  - новые статусы: Предзапись, Пробник, Продажа, Нецелевой лид;
 *  - пустой/нераспознанный статус → «Проверить = да» + unknownStatus;
 *  - Предзапись/Пробник лидоподобны: с клиентским статусом на телефоне — конфликт;
 *  - Потенциал + Нецелевой на одном телефоне конфликтом НЕ считается.
 *
 * Чистая логика без БД (как leads-import-branch.test.ts): собираем входной xlsx
 * в памяти, прогоняем processLeads и читаем результат обратно через readSheet.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { processLeads, type ProcessResult } from "../lib/leads-import/process-leads"
import { readSheet } from "../lib/leads-import/parse-xlsx"
import { parseStatus, toDbStatus, topStatus } from "../lib/leads-import/status-map"

// Реальный порядок колонок выгрузки «Актив»: шапка на первой строке, «Соцсети» нет.
const HEADERS = ["Филиал", "ФИО", "Телефон", "Контактное лицо", "Дата рождения", "Актив"]

function buildInput(rows: Record<string, string>[]): Buffer {
  const aoa = [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ""))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Лист_1")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("Импорт базы — этап 1: формат «Актив»", () => {
  it("шапка на первой строке и колонка «Актив» распознаются, статусы считаются", () => {
    const buf = buildInput([
      { "ФИО": "Иванов Иван", "Телефон": "+7 900 111-11-11", "Контактное лицо": "Мария", "Актив": "Потенциал", "Филиал": "Новокуркино" },
      { "ФИО": "Петров Петя", "Телефон": "+7 900 222-22-22", "Актив": "Нецелевой лид", "Филиал": "Путилково" },
      { "ФИО": "Сидорова Оля", "Телефон": "+7 900 333-33-33", "Актив": "Предзапись", "Филиал": "Путилково" },
      { "ФИО": "Кузнецов Лев", "Телефон": "+7 900 444-44-44", "Актив": "Пробник", "Филиал": "Новокуркино" },
      { "ФИО": "Орлова Яна", "Телефон": "+7 900 555-55-55", "Актив": "Продажа", "Филиал": "Новокуркино" },
      { "ФИО": "Волков Ким", "Телефон": "+7 900 666-66-66", "Актив": "выбыл", "Филиал": "Бескудниково" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true, "конфликтов быть не должно")
    const ok = result as ProcessResult
    assert.equal(ok.stats.totalInput, 6)
    assert.equal(ok.stats.byStatus["Потенциал"], 1)
    assert.equal(ok.stats.byStatus["Нецелевой"], 1)
    assert.equal(ok.stats.byStatus["Предзапись"], 1)
    assert.equal(ok.stats.byStatus["Пробник"], 1)
    assert.equal(ok.stats.byStatus["Продажа"], 1)
    assert.equal(ok.stats.byStatus["Выбыл"], 1)
    assert.equal(ok.stats.unknownStatus, 0)

    const out = readSheet(ok.fileBuffer, { headerRow: 0 })
    const ivanov = out.find((r) => String(r["Ребёнок"]).startsWith("Иванов"))
    assert.ok(ivanov, "строка Иванова найдена")
    assert.equal(ivanov!["Статус"], "Потенциал")
    assert.equal(ivanov!["Филиал"], "Новокуркино")
  })

  it("пустой или нераспознанный статус → «Проверить = да» + unknownStatus", () => {
    const buf = buildInput([
      { "ФИО": "Иванов Иван", "Телефон": "+7 900 111-11-11", "Контактное лицо": "Мария", "Актив": "Потенциал", "Филиал": "Новокуркино" },
      { "ФИО": "Петров Петя", "Телефон": "+7 900 222-22-22", "Контактное лицо": "Ольга", "Актив": "", "Филиал": "Путилково" },
      { "ФИО": "Сидорова Оля", "Телефон": "+7 900 333-33-33", "Контактное лицо": "Анна", "Актив": "79264966818", "Филиал": "Путилково" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true)
    const ok = result as ProcessResult
    assert.equal(ok.stats.unknownStatus, 2, "две строки с невалидным статусом")
    assert.ok(ok.stats.needsReview >= 2, "они же входят в needsReview")

    const out = readSheet(ok.fileBuffer, { headerRow: 0 })
    const petrov = out.find((r) => String(r["Ребёнок"]).startsWith("Петров"))
    assert.equal(petrov!["Проверить"], "да", "пустой статус помечен на проверку")
    const sidorova = out.find((r) => String(r["Ребёнок"]).startsWith("Сидорова"))
    assert.equal(sidorova!["Проверить"], "да", "мусорный статус помечен на проверку")
    const ivanov = out.find((r) => String(r["Ребёнок"]).startsWith("Иванов"))
    assert.equal(ivanov!["Проверить"], "", "валидная строка не помечена")
  })

  it("Предзапись + Выбыл на одном телефоне → конфликт phone_has_lead_and_others", () => {
    const buf = buildInput([
      { "ФИО": "Смирнов Марк", "Телефон": "+7 900 777-77-77", "Актив": "Предзапись", "Филиал": "Новокуркино" },
      { "ФИО": "Смирнова Ева", "Телефон": "+7 900 777-77-77", "Актив": "Выбыл", "Филиал": "Новокуркино" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, false, "должен быть конфликт")
    if (result.ok) return
    assert.ok(
      result.conflicts.some((c) => c.reason === "phone_has_lead_and_others"),
      "предзапись лидоподобна и конфликтует с клиентской историей",
    )
  })

  it("Потенциал + Нецелевой на одном телефоне конфликтом НЕ считается", () => {
    const buf = buildInput([
      { "ФИО": "Козлов Тим", "Телефон": "+7 900 888-88-88", "Актив": "Потенциал", "Филиал": "Путилково" },
      { "ФИО": "Козлова Мия", "Телефон": "+7 900 888-88-88", "Актив": "Нецелевой лид", "Филиал": "Путилково" },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true, "оба статуса клиентские — приоритет разрулит на этапе 2")
  })
})

describe("Импорт базы — карта статусов «Актив»", () => {
  it("новые статусы парсятся и маппятся в БД-статусы", () => {
    assert.equal(parseStatus("Нецелевой лид"), "Нецелевой")
    assert.equal(parseStatus("предзапись"), "Предзапись")
    assert.equal(parseStatus("Пробник"), "Пробник")
    assert.equal(parseStatus("Продажа"), "Продажа")

    assert.deepEqual(toDbStatus("Предзапись"), { funnelStatus: "new", clientStatus: null })
    assert.deepEqual(toDbStatus("Пробник"), { funnelStatus: "trial_scheduled", clientStatus: null })
    assert.deepEqual(toDbStatus("Нецелевой"), { funnelStatus: "non_target", clientStatus: null })
    assert.deepEqual(toDbStatus("Продажа"), { funnelStatus: "active_client", clientStatus: "active" })
  })

  it("приоритеты: Продажа главнее Выбыл, Потенциал главнее Нецелевого", () => {
    assert.equal(topStatus(["Выбыл", "Продажа"]), "Продажа")
    assert.equal(topStatus(["Нецелевой", "Потенциал"]), "Потенциал")
    assert.equal(topStatus(["Черный список", "Продажа"]), "Черный список")
  })
})
