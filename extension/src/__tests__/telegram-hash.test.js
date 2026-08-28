import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { detectTelegramClient, parseTelegramChatId } from "../common/telegram-hash.js"

// Формат хэша Telegram — главный хрупкий стык расширения: если он поменяется,
// панель молча перестанет находить клиентов. Фиксируем оба клиента (/k и /a).

describe("detectTelegramClient", () => {
  it("/a — это WebA", () => {
    assert.equal(detectTelegramClient("/a/"), "a")
  })
  it("/k — это WebK", () => {
    assert.equal(detectTelegramClient("/k/"), "k")
  })
  it("корень отдаём WebK: он открывается по умолчанию чаще", () => {
    assert.equal(detectTelegramClient("/"), "k")
  })
})

describe("parseTelegramChatId — WebK", () => {
  it("@username", () => {
    assert.equal(parseTelegramChatId("#@masha"), "masha")
  })
  it("числовой peer id", () => {
    assert.equal(parseTelegramChatId("#123456789"), "123456789")
  })
  it("отрицательный id группы сохраняем со знаком", () => {
    assert.equal(parseTelegramChatId("#-1001234567890"), "-1001234567890")
  })
  it("внутренний вид /im?p=@username", () => {
    assert.equal(parseTelegramChatId("#/im?p=@masha&post=42"), "masha")
  })
  it("внутренний вид с числовым peer", () => {
    assert.equal(parseTelegramChatId("#/im?p=123456"), "123456")
  })
  it("процентное кодирование раскрывается", () => {
    assert.equal(parseTelegramChatId("#%40masha"), "masha")
  })
})

describe("parseTelegramChatId — WebA", () => {
  it("числовой chatId", () => {
    assert.equal(parseTelegramChatId("#123456789"), "123456789")
  })
  it("части через подчёркивание — берём первую", () => {
    assert.equal(parseTelegramChatId("#123456789_5_1"), "123456789")
  })
  it("супергруппа с -100", () => {
    assert.equal(parseTelegramChatId("#-1001234567890_2"), "-1001234567890")
  })
})

describe("parseTelegramChatId — чата нет", () => {
  it("пустой хэш (открыт список диалогов)", () => {
    assert.equal(parseTelegramChatId(""), null)
    assert.equal(parseTelegramChatId("#"), null)
  })
  it("служебный tgaddr", () => {
    assert.equal(parseTelegramChatId("#?tgaddr=tg%3A%2F%2Fresolve"), null)
  })
  it("внутренний путь без параметров", () => {
    assert.equal(parseTelegramChatId("#/im"), null)
  })
  it("одна собака", () => {
    assert.equal(parseTelegramChatId("#@"), null)
  })
  it("слишком короткий ник не считаем идентификатором", () => {
    assert.equal(parseTelegramChatId("#ab"), null)
  })
  it("мусор со спецсимволами", () => {
    assert.equal(parseTelegramChatId("#!!!"), null)
  })
})

describe("parseTelegramChatId — устойчивость", () => {
  it("битое процентное кодирование не роняет разбор", () => {
    assert.equal(parseTelegramChatId("#%E0%A4%A"), null)
  })
  it("хэш без решётки понимается так же", () => {
    assert.equal(parseTelegramChatId("@masha"), "masha")
  })
  it("пробелы обрезаются", () => {
    assert.equal(parseTelegramChatId("#  @masha  "), "masha")
  })
})
