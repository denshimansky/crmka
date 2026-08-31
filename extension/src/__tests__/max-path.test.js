import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseMaxPath, isServiceableMaxChat } from "../common/max-path.js"

// Адрес — единственный источник «какой чат открыт» в MAX: хэша у него нет, а
// id чата в разметке не встречается вовсе. Формы адреса подтверждены живыми
// прогонами 31.08.2026 (docs/messenger-extension.md §8, Шаг 1).

describe("parseMaxPath", () => {
  it("личный чат — один положительный сегмент", () => {
    assert.deepEqual(parseMaxPath("/437719203"), { kind: "chat", chatId: "437719203" })
  })

  it("групповой чат — тот же сегмент со знаком минус", () => {
    assert.deepEqual(parseMaxPath("/-78377804395205"), {
      kind: "group",
      chatId: "-78377804395205",
    })
  })

  it("список чатов — пустой путь", () => {
    assert.equal(parseMaxPath("/").kind, "chat-list")
    assert.equal(parseMaxPath("").kind, "chat-list")
  })

  it("хвостовой слеш не мешает", () => {
    assert.deepEqual(parseMaxPath("/437719203/"), { kind: "chat", chatId: "437719203" })
  })

  it("query и хэш отрезаются", () => {
    assert.deepEqual(parseMaxPath("/437719203?utm=1#anchor"), {
      kind: "chat",
      chatId: "437719203",
    })
  })

  it("длинный id остаётся строкой — Number() съел бы разряды", () => {
    const id = "78377804395205123"
    assert.equal(parseMaxPath(`/${id}`).chatId, id)
    // Замок: как только кто-нибудь пропустит id через Number, тест упадёт.
    assert.notEqual(String(Number(id)), id)
  })

  it("многосегментный путь чатом не считаем", () => {
    // «/c/<chatId>/<messageId>» — ссылка на сообщение канала. Угадывать чат в
    // незнакомой форме адреса опаснее, чем показать «откройте диалог».
    assert.deepEqual(parseMaxPath("/c/1234567890123/987"), { kind: "other", chatId: null })
    assert.equal(parseMaxPath("/u/12345").kind, "other")
  })

  it("нечисловой сегмент — не чат", () => {
    assert.equal(parseMaxPath("/settings").kind, "other")
    assert.equal(parseMaxPath("/:chat-list").kind, "other")
    assert.equal(parseMaxPath("/joincall").kind, "other")
  })

  it("ноль и «минус ноль» чатом не бывают", () => {
    assert.equal(parseMaxPath("/0").kind, "other")
    assert.equal(parseMaxPath("/-0").kind, "other")
    assert.equal(parseMaxPath("/007").kind, "other")
  })

  it("мусор на входе не роняет разбор", () => {
    assert.equal(parseMaxPath(null).kind, "chat-list")
    assert.equal(parseMaxPath(undefined).kind, "chat-list")
    assert.equal(parseMaxPath("/12 34").kind, "other")
    assert.equal(parseMaxPath("/12.34").kind, "other")
    assert.equal(parseMaxPath("/+1234").kind, "other")
  })
})

describe("isServiceableMaxChat", () => {
  it("обслуживаем только личный диалог", () => {
    assert.equal(isServiceableMaxChat(parseMaxPath("/437719203")), true)
  })

  // Замок на решение спеки: групповая переписка чужих родителей, уехавшая в
  // карточку одного человека, необратима — ключ дедупа не даст её переписать.
  it("групповой чат — НЕТ", () => {
    assert.equal(isServiceableMaxChat(parseMaxPath("/-78377804395205")), false)
  })

  it("список чатов и незнакомые адреса — НЕТ", () => {
    assert.equal(isServiceableMaxChat(parseMaxPath("/")), false)
    assert.equal(isServiceableMaxChat(parseMaxPath("/c/123/987")), false)
  })
})
