/**
 * Этап 2 импорта (07.08.2026): при загрузке заполненного шаблона строки-дубли
 * «один ребёнок в нескольких строках одного телефона» должны схлопываться в
 * одного подопечного (раньше создавалось 10 одинаковых детей у родителя — кейс
 * ДЦ Знамникус), а дата рождения должна доезжать и когда её вбили в Excel
 * типизированной ячейкой (JS Date), а не строкой.
 *
 * Тестируем чистую часть (parse-leads-file.ts) — без БД.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import {
  loadLeadsFile,
  dedupLeadRows,
  parseDob,
  type LeadFileRow,
} from "../lib/leads-import/parse-leads-file"

function row(over: Partial<LeadFileRow>): LeadFileRow {
  return {
    parent: "",
    phone: "",
    child: "",
    socials: "",
    birthDate: null,
    status: null,
    branch: "",
    balance: 0,
    balanceFromFile: false,
    needsReview: false,
    rowIdx: 0,
    ...over,
  }
}

describe("dedupLeadRows — схлопывание дублей ребёнка", () => {
  it("один ребёнок в 10 строках одного телефона → одна строка", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ phone: "79774069833", child: "Шапкин Илья", status: "Выбыл", rowIdx: i + 2 }),
    )
    const res = dedupLeadRows(rows)
    assert.equal(res.rows.length, 1, "остаётся один ребёнок")
    assert.equal(res.collapsed, 9, "схлопнуто 9 дублей")
    assert.equal(res.rows[0].child, "Шапкин Илья")
  })

  it("разные дети одного телефона (братья/сёстры) НЕ схлопываются", () => {
    const res = dedupLeadRows([
      row({ phone: "79270928234", child: "Рамзанова Аиша" }),
      row({ phone: "79270928234", child: "Рамзанов Ахмед" }),
    ])
    assert.equal(res.rows.length, 2, "оба ребёнка сохранены")
    assert.equal(res.collapsed, 0)
  })

  it("строки без телефона остаются отдельными (не схлопываются между собой)", () => {
    const res = dedupLeadRows([
      row({ phone: "", child: "Иванов Иван", socials: "vk/a" }),
      row({ phone: "", child: "Иванов Иван", socials: "vk/b" }),
    ])
    assert.equal(res.rows.length, 2)
    assert.equal(res.collapsed, 0)
  })

  it("баланс НЕ суммируется по дублям одного ребёнка, статус берётся приоритетный", () => {
    const res = dedupLeadRows([
      row({ phone: "7900", child: "Петров Пётр", status: "Лид", balance: 500, balanceFromFile: true }),
      row({ phone: "7900", child: "Петров Пётр", status: "Продажа", balance: 500, balanceFromFile: true }),
    ])
    assert.equal(res.rows.length, 1)
    assert.equal(res.rows[0].balance, 500, "баланс не умножился на число строк")
    assert.equal(res.rows[0].status, "Продажа", "приоритетный статус (Продажа > Лид)")
  })

  it("дата/родитель/филиал берутся из первой непустой строки дубля", () => {
    const res = dedupLeadRows([
      row({ phone: "7901", child: "Сидорова Аня" }),
      row({ phone: "7901", child: "Сидорова Аня", parent: "Сидорова Мария", branch: "Центр", birthDate: "01.02.19" }),
    ])
    assert.equal(res.rows.length, 1)
    assert.equal(res.rows[0].parent, "Сидорова Мария")
    assert.equal(res.rows[0].branch, "Центр")
    assert.equal(res.rows[0].birthDate, "01.02.19")
  })
})

describe("parseDob — дата рождения из строки и из ячейки Excel", () => {
  it("JS Date (типизированная ячейка Excel) без сдвига на день", () => {
    // 30.11.2018 00:00 локально — как отдаёт xlsx cellDates
    const d = parseDob(new Date(2018, 10, 30))
    assert.ok(d, "дата распознана")
    assert.equal(d!.toISOString(), "2018-11-30T00:00:00.000Z", "день не уехал назад")
  })

  it("строка DD.MM.YY", () => {
    assert.equal(parseDob("30.11.18")!.toISOString(), "2018-11-30T00:00:00.000Z")
  })

  it("строка DD.MM.YYYY и YYYY-MM-DD", () => {
    assert.equal(parseDob("05.03.2020")!.toISOString(), "2020-03-05T00:00:00.000Z")
    assert.equal(parseDob("2021-07-09")!.toISOString(), "2021-07-09T00:00:00.000Z")
  })

  it("пусто / мусор / null → null", () => {
    assert.equal(parseDob(""), null)
    assert.equal(parseDob(null), null)
    assert.equal(parseDob(undefined), null)
    assert.equal(parseDob("не дата"), null)
  })
})

describe("loadLeadsFile + dedup — сквозной путь с датой-ячейкой Excel", () => {
  it("шаблон с типизированной датой: дедуп схлопывает, дата доезжает", () => {
    const headers = [
      "Фамилия Имя родителя", "Номер_телефона", "Ребёнок", "Соцсети",
      "Дата_рождения", "Статус", "Филиал", "Баланс",
    ]
    const aoa: unknown[][] = [headers]
    // Один ребёнок дважды (типизированная дата) + отдельный ребёнок того же телефона
    aoa.push(["Шапкина Ольга", "79774069833", "Шапкин Илья", "", new Date(2018, 10, 30), "Выбыл", "Центр", ""])
    aoa.push(["Шапкина Ольга", "79774069833", "Шапкин Илья", "", new Date(2018, 10, 30), "Продажа", "Центр", ""])
    aoa.push(["Шапкина Ольга", "79774069833", "Шапкина Вера", "", "12.05.20", "Продажа", "Центр", ""])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Клиенты")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer

    const parsed = loadLeadsFile(buf)
    assert.equal(parsed.rows.length, 3, "прочитаны все 3 строки")
    const dd = dedupLeadRows(parsed.rows)
    assert.equal(dd.rows.length, 2, "Илья схлопнут в одного, Вера отдельно")
    assert.equal(dd.collapsed, 1)

    const ilya = dd.rows.find((r) => r.child === "Шапкин Илья")!
    assert.equal(parseDob(ilya.birthDate)!.toISOString(), "2018-11-30T00:00:00.000Z")
    const vera = dd.rows.find((r) => r.child === "Шапкина Вера")!
    assert.equal(parseDob(vera.birthDate)!.toISOString(), "2020-05-12T00:00:00.000Z")
  })
})
