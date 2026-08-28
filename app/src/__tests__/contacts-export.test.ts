/**
 * Unit-тесты выгрузки вкладок «Клиенты» в Excel (28.08.2026).
 *
 * Главный инвариант: файл повторяет экран. Набор и порядок столбцов вкладки
 * заданы в contacts-export.ts и оттуда же берутся таблицей — эти тесты держат
 * договор, чтобы правка столбцов на экране не разошлась молча с выгрузкой.
 *
 * Чистая логика без БД и без React.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  columnsForTab,
  exportCell,
  sortRows,
  type ContactsCellCtx,
} from "../app/(dashboard)/crm/contacts/contacts-export"
import type { ContactRow, ContactsTabKey } from "../app/(dashboard)/crm/contacts/contacts-table"

const ctx: ContactsCellCtx = {
  employeeLabel: (id) => (id === "e1" ? "Иванова Мария" : ""),
  instructorLabel: "Инструктор",
}

function row(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "c1",
    firstName: "Марина",
    lastName: "Тарасова",
    phone: "79216110636",
    socialLink: null,
    segment: "regular",
    channelName: "Инстаграм",
    branchName: "Первое слово",
    funnelStatus: "active_client",
    clientStatus: "active",
    comment: "перезвонить",
    nextContactDate: "2026-09-01T00:00:00.000Z",
    assignedTo: "e1",
    createdAt: "2026-07-08T00:00:00.000Z",
    wards: [{ id: "w1", firstName: "Вадим", lastName: "Тарасов", birthDate: "2021-03-04T00:00:00.000Z" }],
    activeSubscription: {
      directionName: "Говорилка",
      groupName: "Говорилка 3+",
      branchName: "Первое слово",
      instructor: { id: "i1", name: "Черекбашева Наталья" },
    },
    hasActiveSubscription: true,
    topSalesStage: null,
    ...over,
  }
}

const ALL_TABS: ContactsTabKey[] = [
  "leads",
  "potential",
  "nontarget",
  "active",
  "churned",
  "archived",
  "blacklist",
  "all",
]

describe("columnsForTab", () => {
  it("столбцы каждой вкладки совпадают с шапкой таблицы", () => {
    const ids = (tab: ContactsTabKey) => columnsForTab(tab, "Инструктор").map((c) => c.id)
    assert.deepEqual(ids("leads"), [
      "parent", "phone", "social", "wards", "branch",
      "nextContact", "comment", "channel", "created", "assigned",
    ])
    assert.deepEqual(ids("potential"), [
      "parent", "phone", "social", "wards", "branch", "nextContact", "comment", "assigned",
    ])
    assert.deepEqual(ids("nontarget"), [
      "parent", "phone", "social", "wards", "branch", "comment", "assigned",
    ])
    assert.deepEqual(ids("active"), [
      "parent", "phone", "social", "wards", "segment", "branch",
      "direction", "group", "instructor", "nextContact", "comment", "assigned",
    ])
    assert.deepEqual(ids("churned"), [
      "parent", "phone", "social", "birth", "branch", "nextContact",
    ])
    assert.deepEqual(ids("archived"), ["parent", "phone", "social", "birth", "branch"])
    assert.deepEqual(ids("blacklist"), ["parent", "phone", "social", "birth", "branch"])
    assert.deepEqual(ids("all"), [
      "state", "parent", "phone", "social", "wards", "branch", "comment",
    ])
  })

  it("«Состояние» только во «Все», «Дата рождения» только в неактивных вкладках", () => {
    for (const tab of ALL_TABS) {
      const ids = columnsForTab(tab, "Инструктор").map((c) => c.id)
      assert.equal(ids.includes("state"), tab === "all", `state в ${tab}`)
      assert.equal(
        ids.includes("birth"),
        tab === "churned" || tab === "archived" || tab === "blacklist",
        `birth в ${tab}`,
      )
      // ФИО, телефон, соцсети и филиал есть везде — базовый набор.
      for (const must of ["parent", "phone", "social", "branch"]) {
        assert.ok(ids.includes(must as never), `${must} в ${tab}`)
      }
    }
  })

  it("заголовок столбца инструктора берётся из названия роли организации", () => {
    const cols = columnsForTab("active", "Педагог")
    assert.equal(cols.find((c) => c.id === "instructor")?.header, "Педагог")
  })

  it("у каждого столбца непустой заголовок и ширина", () => {
    for (const tab of ALL_TABS) {
      for (const c of columnsForTab(tab, "Инструктор")) {
        assert.ok(c.header.length > 0, `${tab}/${c.id}: пустой заголовок`)
        assert.ok(c.width > 0, `${tab}/${c.id}: нет ширины`)
      }
    }
  })
})

describe("exportCell", () => {
  it("значения основных столбцов", () => {
    const r = row()
    assert.equal(exportCell(r, "parent", ctx), "Тарасова Марина")
    assert.equal(exportCell(r, "phone", ctx), "79216110636")
    assert.equal(exportCell(r, "wards", ctx), "Тарасов Вадим")
    assert.equal(exportCell(r, "segment", ctx), "Постоянный")
    assert.equal(exportCell(r, "branch", ctx), "Первое слово")
    assert.equal(exportCell(r, "direction", ctx), "Говорилка")
    assert.equal(exportCell(r, "instructor", ctx), "Черекбашева Наталья")
    assert.equal(exportCell(r, "assigned", ctx), "Иванова Мария")
    assert.equal(exportCell(r, "channel", ctx), "Инстаграм")
  })

  it("даты — в формате дд.мм.гггг", () => {
    const r = row()
    assert.equal(exportCell(r, "created", ctx), "08.07.2026")
    assert.equal(exportCell(r, "nextContact", ctx), "01.09.2026")
    assert.equal(exportCell(r, "birth", ctx), "04.03.2021")
  })

  it("пусто вместо «—»: в Excel прочерк ломает фильтры", () => {
    const r = row({
      phone: null,
      socialLink: null,
      comment: null,
      branchName: null,
      channelName: null,
      nextContactDate: null,
      assignedTo: null,
      wards: [],
      activeSubscription: null,
    })
    for (const key of ["phone", "social", "comment", "branch", "channel", "nextContact", "assigned", "wards", "birth", "direction", "group", "instructor"] as const) {
      const v = exportCell(r, key, ctx)
      assert.equal(v, "", `${key} → «${v}» вместо пустого`)
    }
  })

  it("группа выгружается полным названием (обрезка — забота вёрстки)", () => {
    const long = "Говорилка 3+ вторник/четверг 18:00 кабинет 2"
    const r = row({
      activeSubscription: {
        directionName: "Говорилка",
        groupName: long,
        branchName: null,
        instructor: { id: null, name: "—" },
      },
    })
    assert.equal(exportCell(r, "group", ctx), long)
    // Инструктора нет → пусто, а не «—».
    assert.equal(exportCell(r, "instructor", ctx), "")
  })

  it("столбец «Состояние» вкладки «Все» заполнен для любого клиента", () => {
    const r = exportCell(row({ funnelStatus: "new", clientStatus: null }), "state", ctx)
    assert.ok(r.length > 0)
  })
})

describe("sortRows", () => {
  const a = row({ id: "a", lastName: "Яковлева", firstName: "Анна" })
  const b = row({ id: "b", lastName: "Абрамова", firstName: "Вера" })
  const c = row({ id: "c", lastName: null, firstName: null, comment: null })

  it("без ключа сортировки порядок сервера не трогаем", () => {
    assert.deepEqual(sortRows([a, b], null, "asc", ctx).map((r) => r.id), ["a", "b"])
  })

  it("сортировка по ФИО в обе стороны", () => {
    assert.deepEqual(sortRows([a, b], "parent", "asc", ctx).map((r) => r.id), ["b", "a"])
    assert.deepEqual(sortRows([a, b], "parent", "desc", ctx).map((r) => r.id), ["a", "b"])
  })

  it("пустые значения уходят в конец при любом направлении", () => {
    const rows = [c, a, b]
    assert.equal(sortRows(rows, "comment", "asc", ctx).at(-1)?.id, "c")
    assert.equal(sortRows(rows, "comment", "desc", ctx).at(-1)?.id, "c")
  })

  it("исходный массив не мутируется", () => {
    const rows = [a, b]
    sortRows(rows, "parent", "asc", ctx)
    assert.deepEqual(rows.map((r) => r.id), ["a", "b"])
  })
})
