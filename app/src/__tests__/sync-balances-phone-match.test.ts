/**
 * Unit-тесты сопоставления клиентов по телефону при «Синхронизировать остатки».
 * Баг: в файле остатков телефоны в виде «79998887766», а в CRM клиент может
 * храниться как «+79998887766» (POST /api/clients пишет телефон «как ввели»).
 * indexClientsByNormPhone должен матчить их как один номер.
 *
 * Чистая логика без БД: проверяем построение карты нормализованный телефон → клиент.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { indexClientsByNormPhone, normPhone } from "../lib/leads-import/parse-xlsx"

type Row = { id: string; phone: string | null }
const wantedOf = (...raw: string[]) => new Set(raw.map((r) => normPhone(r)))

describe("Синхронизация остатков — матч телефона", () => {
  it("«+79998887766» в БД матчится к «79998887766» из файла", () => {
    const wanted = wantedOf("79998887766")
    const map = indexClientsByNormPhone<Row>([{ id: "c1", phone: "+79998887766" }], wanted)
    assert.equal(map.get("79998887766")?.id, "c1", "клиент с «+7…» найден по нормализованному номеру")
  })

  it("пробелы/дефисы/скобки в номере БД не мешают матчу", () => {
    const wanted = wantedOf("79998887766")
    const map = indexClientsByNormPhone<Row>(
      [{ id: "c2", phone: "+7 (999) 888-77-66" }],
      wanted,
    )
    assert.equal(map.get("79998887766")?.id, "c2")
  })

  it("клиенты вне файла в карту не попадают", () => {
    const wanted = wantedOf("79998887766")
    const map = indexClientsByNormPhone<Row>(
      [
        { id: "c1", phone: "+79998887766" },
        { id: "other", phone: "+79990000000" },
        { id: "noPhone", phone: null },
      ],
      wanted,
    )
    assert.equal(map.size, 1, "только совпавший номер")
    assert.equal(map.get("79998887766")?.id, "c1")
  })

  it("при двух клиентах с одним номером побеждает первый (старейший по createdAt asc)", () => {
    const wanted = wantedOf("79998887766")
    const map = indexClientsByNormPhone<Row>(
      [
        { id: "old", phone: "79998887766" },
        { id: "new", phone: "+7 999 888-77-66" },
      ],
      wanted,
    )
    assert.equal(map.get("79998887766")?.id, "old", "первый в порядке (старейший) выигрывает")
  })

  it("пустой/мусорный телефон клиента игнорируется", () => {
    const wanted = wantedOf("79998887766")
    const map = indexClientsByNormPhone<Row>(
      [
        { id: "junk", phone: "—" },
        { id: "empty", phone: "" },
      ],
      wanted,
    )
    assert.equal(map.size, 0)
  })
})
