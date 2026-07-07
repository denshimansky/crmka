/**
 * Слой валидации контактов при импорте (07.07.2026): у каждой строки должен
 * быть заполнен телефон ИЛИ соцсети — иначе клиент не находится поиском,
 * не матчится по телефону и повторный импорт плодит дубли (кейс «Колташева»).
 *
 * Механика: Этап 1 (processLeads) НЕ блокирует, а помечает такие строки
 * «Проверить = да» в промежуточном файле (как другие проблемные). Этап 2
 * (syncLeads) строки с «Проверить = да» и строки без контактов не пропускает —
 * блокирует загрузку целиком. Здесь тестируем этап 1 — чистая функция без БД.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { processLeads } from "../lib/leads-import/process-leads"

interface RawRow {
  fio: string
  /** «Контактное лицо» (родитель) — без него строка помечается «Проверить»
   *  по независимой причине (ФИО родителя не собрать), заполняем в тестах. */
  contact?: string
  phone?: string
  socials?: string
  status?: string
  branch?: string
}

function makeRawFile(rows: RawRow[]): Buffer {
  const headers = ["ФИО", "Контактное лицо", "Телефон", "Соцсети", "Дата рождения", "Состояние лида", "Филиал"]
  const aoa: unknown[][] = [headers]
  for (const r of rows) {
    aoa.push([
      r.fio,
      r.contact ?? "Иванова Мария",
      r.phone ?? "",
      r.socials ?? "",
      "",
      r.status ?? "Выбыл",
      r.branch ?? "",
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Лист1")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

/** Читает выходной промежуточный файл в массив строк. */
function readOutput(fileBuffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(fileBuffer, { type: "buffer" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]
}

describe("processLeads — обязательные контакты (телефон ИЛИ соцсети)", () => {
  it("строка без телефона и без соцсетей помечается «Проверить = да», файл формируется", () => {
    const res = processLeads(makeRawFile([
      { fio: "Иванов Иван", phone: "79001234567" },
      { fio: "Колташева София" }, // ни телефона, ни соцсетей
    ]))
    assert.equal(res.ok, true, "этап 1 не блокирует — только помечает")
    if (res.ok) {
      assert.equal(res.stats.noContacts, 1)
      assert.equal(res.stats.needsReview, 1)
      const rows = readOutput(res.fileBuffer)
      const bad = rows.find((r) => String(r["Ребёнок"]).includes("Колташева"))
      assert.ok(bad, "строка в выходном файле есть")
      assert.equal(String(bad!["Проверить"]), "да", "помечена на проверку")
      const good = rows.find((r) => String(r["Ребёнок"]).includes("Иванов"))
      assert.equal(String(good!["Проверить"]), "", "строка с телефоном не помечена")
    }
  })

  it("соцсети без телефона — контактная проверка не помечает", () => {
    // ФИО то же, что в первом тесте проходит без пометки, — изолируем
    // именно контактную проверку от независимой логики согласования ФИО.
    const res = processLeads(makeRawFile([
      { fio: "Иванов Иван", socials: "https://vk.com/ivanov" },
    ]))
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.stats.noContacts, 0)
      const rows = readOutput(res.fileBuffer)
      assert.equal(String(rows[0]["Проверить"]), "")
    }
  })

  it("мусорный телефон без цифр = пустой: без соцсетей помечается «да»", () => {
    const res = processLeads(makeRawFile([{ fio: "Иванов Иван", phone: "нет" }]))
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.stats.noContacts, 1)
      const rows = readOutput(res.fileBuffer)
      assert.equal(String(rows[0]["Проверить"]), "да")
    }
  })

  it("конфликты статусов по-прежнему блокируют этап 1 (список проблемных)", () => {
    const res = processLeads(makeRawFile([
      { fio: "Иванов Иван", phone: "79001234567", status: "Лид" },
      { fio: "Иванов Пётр", phone: "79001234567", status: "Выбыл" },
    ]))
    assert.equal(res.ok, false, "Лид + другой статус на одном телефоне — конфликт")
    if (!res.ok) {
      assert.ok(res.conflicts.length > 0)
      assert.ok(
        res.conflicts.every((c) => c.reason !== ("no_contacts" as never)),
        "причины только про статусы/филиалы",
      )
    }
  })
})
