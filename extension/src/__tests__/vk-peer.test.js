import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseVkLocation, isServiceableVkChat } from "../common/vk-peer.js"

// Адрес — источник «какой диалог открыт» в ВК: собеседник назван прямо в нём,
// параметром «sel». Главный замок этого файла — что идентификатором чата
// становится СОБЕСЕДНИК, а не сообщество из пути: приняв путь за ключ, панель
// сложила бы переписку всех родителей центра в одну карточку (та же системная
// коллизия, что была найдена в MAX, только шире).
//
// ⚠️ Формы адреса живой проверкой ещё не подтверждены — их даёт
// tools/vk-probe.js (Шаг 1 Фазы 6). Тесты фиксируют то, что реализовано.

// Формы НОВОГО VK Messenger — сняты живым прогоном 01.09.2026 (probe в
// сообществе «УМНЫЙ Я / Олимпик / Димитровград»). Заочное предположение про
// «?sel=» они опровергли: диалог назван в пути, сегментом после «convo».
describe("parseVkLocation — новый VK Messenger (живой факт)", () => {
  it("адрес из прогона разбирается в собеседника, а не в сообщество", () => {
    const result = parseVkLocation("https://vk.ru/gim137130907/convo/335368817?entrypoint=list_all")
    assert.equal(result.kind, "chat")
    assert.equal(result.chatId, "335368817")
    assert.equal(result.community, "137130907")
  })

  it("два диалога одного сообщества дают РАЗНЫЕ ключи", () => {
    const first = parseVkLocation("/gim137130907/convo/335368817")
    const second = parseVkLocation("/gim137130907/convo/999888777")
    assert.notEqual(first.chatId, second.chatId)
  })

  it("сообщество открыто, диалог не выбран", () => {
    assert.equal(parseVkLocation("/gim137130907").kind, "chat-list")
    assert.equal(parseVkLocation("/gim137130907/convo").kind, "chat-list")
  })

  it("личные сообщения в новом интерфейсе — тот же сегмент convo", () => {
    assert.equal(parseVkLocation("/im/convo/335368817").chatId, "335368817")
  })

  it("беседа в новом интерфейсе ловится по кодировке peer_id", () => {
    assert.equal(parseVkLocation("/gim137130907/convo/2000000045").kind, "multi")
    assert.equal(parseVkLocation("/gim137130907/convo/2000000045").chatId, "c45")
  })

  it("диалог с сообществом — тоже не обслуживаем", () => {
    assert.equal(parseVkLocation("/gim137130907/convo/-216789012").kind, "multi")
  })
})

describe("parseVkLocation — старый интерфейс (sel)", () => {
  it("ключ чата — собеседник из sel, а не сообщество из пути", () => {
    const result = parseVkLocation("/gim216789012?sel=45678901")
    assert.equal(result.kind, "chat")
    assert.equal(result.chatId, "45678901")
    assert.equal(result.community, "216789012")
  })

  it("два диалога одного сообщества дают РАЗНЫЕ ключи", () => {
    const first = parseVkLocation("/gim216789012?sel=45678901")
    const second = parseVkLocation("/gim216789012?sel=99999999")
    assert.notEqual(first.chatId, second.chatId)
  })

  it("сообщество открыто, диалог не выбран — привязывать нечего", () => {
    assert.equal(parseVkLocation("/gim216789012").kind, "chat-list")
    assert.equal(parseVkLocation("/gim216789012").chatId, null)
  })
})

describe("parseVkLocation — личные сообщения", () => {
  it("собеседник из sel", () => {
    assert.deepEqual(parseVkLocation("/im?sel=123456"), {
      kind: "chat",
      chatId: "123456",
      community: null,
    })
  })

  it("старый ВК держал sel в хэше — понимаем и его", () => {
    assert.equal(parseVkLocation("/im#sel=123456").chatId, "123456")
  })

  it("мессенджер открыт, диалог не выбран", () => {
    assert.equal(parseVkLocation("/im").kind, "chat-list")
    assert.equal(parseVkLocation("/").kind, "chat-list")
  })

  it("«id12345» и голое число — один и тот же человек", () => {
    assert.equal(parseVkLocation("/im?sel=id12345").chatId, "12345")
    assert.equal(parseVkLocation("/im?sel=12345").chatId, "12345")
  })
})

describe("parseVkLocation — чаты, которые панель не ведёт", () => {
  it("беседа: «c45» и peer_id 2000000045 — одна и та же", () => {
    assert.deepEqual(parseVkLocation("/im?sel=c45"), {
      kind: "multi",
      chatId: "c45",
      community: null,
    })
    assert.equal(parseVkLocation("/im?sel=2000000045").chatId, "c45")
    assert.equal(parseVkLocation("/im?sel=2000000045").kind, "multi")
  })

  it("диалог с сообществом приводится к «-<N>» из любой записи", () => {
    assert.equal(parseVkLocation("/im?sel=-216789012").chatId, "-216789012")
    assert.equal(parseVkLocation("/im?sel=club216789012").chatId, "-216789012")
    assert.equal(parseVkLocation("/im?sel=public216789012").kind, "multi")
  })

  it("isServiceableVkChat пропускает только диалог с человеком", () => {
    assert.equal(isServiceableVkChat(parseVkLocation("/gim216789012?sel=45678901")), true)
    assert.equal(isServiceableVkChat(parseVkLocation("/im?sel=c45")), false)
    assert.equal(isServiceableVkChat(parseVkLocation("/im?sel=-216789012")), false)
    assert.equal(isServiceableVkChat(parseVkLocation("/im")), false)
  })
})

describe("parseVkLocation — что не является диалогом", () => {
  it("страница вне мессенджера", () => {
    assert.equal(parseVkLocation("/feed").kind, "other")
    assert.equal(parseVkLocation("/durov").kind, "other")
    assert.equal(parseVkLocation("/settings").kind, "other")
  })

  it("мусор в sel не превращается в чат", () => {
    // Пустой (в том числе из одних пробелов) sel читается как «диалог не
    // выбран» — это ровно то состояние, которое человек и видит на экране.
    assert.equal(parseVkLocation("/im?sel=").kind, "chat-list")
    assert.equal(parseVkLocation("/im?sel=%20").kind, "chat-list")
    // Ноль идентификатором не бывает ни у одного канала.
    assert.equal(parseVkLocation("/im?sel=0").kind, "other")
    assert.equal(parseVkLocation("/im?sel=..%2F..").kind, "other")
  })

  it("пустой и отсутствующий вход не роняют разбор", () => {
    assert.equal(parseVkLocation(null).kind, "chat-list")
    assert.equal(parseVkLocation(undefined).kind, "chat-list")
    assert.equal(parseVkLocation("").kind, "chat-list")
  })
})

describe("parseVkLocation — вход объектом location", () => {
  it("читает pathname/search, как в живой вкладке", () => {
    const result = parseVkLocation({ pathname: "/gim216789012", search: "?sel=45678901", hash: "" })
    assert.equal(result.chatId, "45678901")
    assert.equal(result.community, "216789012")
  })

  it("полный адрес строкой тоже разбирается", () => {
    assert.equal(parseVkLocation("https://vk.com/gim216789012?sel=45678901").chatId, "45678901")
    assert.equal(parseVkLocation("https://vk.ru/im?sel=777").chatId, "777")
  })

  it("идентификатор остаётся строкой, без арифметики над ним", () => {
    // Замок: как только кто-нибудь пропустит id человека через Number, тест
    // упадёт — сравнение строгое, а «0123» после Number стало бы «123».
    assert.strictEqual(parseVkLocation("/im?sel=45678901").chatId, "45678901")
  })

  it("граница «человек / беседа» — там же, где её провёл сам ВК", () => {
    // 2 000 000 000 — начало диапазона бесед в кодировке peer_id VK API.
    // Всё, что ниже, — обычный пользователь.
    assert.equal(parseVkLocation("/im?sel=1999999999").kind, "chat")
    assert.equal(parseVkLocation("/im?sel=1999999999").chatId, "1999999999")
    assert.equal(parseVkLocation("/im?sel=2000000001").kind, "multi")
  })
})
