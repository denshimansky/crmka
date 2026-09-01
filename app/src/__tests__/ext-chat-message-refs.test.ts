import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { sanitizeMessageIds } from "../lib/ext/chat-message-refs"
import { isMintedChatKey, normalizeChatId } from "../lib/ext/chat-identity"

// Опознание чата по идентификаторам его сообщений — единственный способ узнать
// диалог в WhatsApp: идентификатора чата в разметке нет вовсе (живой прогон
// 01.09.2026). Здесь закреплены границы, ошибка в которых означает чужую
// переписку в карточке клиента — а её оттуда уже не убрать.

describe("sanitizeMessageIds", () => {
  it("пропускает настоящие идентификаторы WhatsApp", () => {
    assert.deepEqual(sanitizeMessageIds(["2A339FE00B7E3BFBC263", "3EB0C8243B62011A8AAE16"]), [
      "2A339FE00B7E3BFBC263",
      "3EB0C8243B62011A8AAE16",
    ])
  })
  it("выбрасывает дубли, сохраняя порядок", () => {
    assert.deepEqual(sanitizeMessageIds(["ABCDEFGH12", "ABCDEFGH12", "IJKLMNOP34"]), [
      "ABCDEFGH12",
      "IJKLMNOP34",
    ])
  })
  it("короткая строка приметой быть не может", () => {
    // Идентификатор из пары символов совпал бы у разных чатов — а это ровно то,
    // ради чего вся схема и затевалась.
    assert.deepEqual(sanitizeMessageIds(["abc", "12"]), [])
  })
  it("мусор и не-строки отсекаются", () => {
    assert.deepEqual(sanitizeMessageIds(["с пробелом внутри", "<script>", 42, null, {}]), [])
  })
  it("не массив — пустой список, а не исключение", () => {
    // Приходит из браузера сотрудника: это вход, а не факт.
    assert.deepEqual(sanitizeMessageIds("2A339FE00B7E3BFBC263"), [])
    assert.deepEqual(sanitizeMessageIds(undefined), [])
  })
  it("список ограничен по длине", () => {
    const many = Array.from({ length: 50 }, (_, i) => `MESSAGE${String(i).padStart(4, "0")}`)
    assert.equal(sanitizeMessageIds(many).length, 20)
  })
})

describe("ключ чата, выданный нами", () => {
  it("опознаётся по префиксу", () => {
    assert.equal(isMintedChatKey("wa-msg:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"), true)
    assert.equal(isMintedChatKey("79001234567@c.us"), false)
    assert.equal(isMintedChatKey(null), false)
  })

  it("НЕ разбирается как телефон", () => {
    // Мина, стоившая разбирательства в MAX: ветка «оставшиеся цифры — это
    // номер» превратила бы «wa-msg:0f1e2d3c-4b5a-…» в десятизначное число из
    // цифр uuid, и сервер пошёл бы искать клиента по этому «номеру».
    const key = "wa-msg:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"
    assert.equal(normalizeChatId("whatsapp", key), key)
  })

  it("переживает нормализацию без изменений и в других каналах", () => {
    // Ключ канало-независим по форме, и нормализация не должна его портить:
    // по нему построены ключи дедупа уже залитой переписки.
    const key = "wa-msg:11111111-2222-3333-4444-555555555555"
    assert.equal(normalizeChatId("telegram", key), key)
    assert.equal(normalizeChatId("max", key), key)
  })
})
