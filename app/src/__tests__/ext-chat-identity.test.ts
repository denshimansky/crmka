import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildMessageExternalId,
  handleFieldForChannel,
  isMessengerChannel,
  normalizeChatId,
  normalizeHandle,
} from "../lib/ext/chat-identity"

// Нормализация — фундамент матчинга «открытый чат ↔ карточка клиента»
// (docs/messenger-extension.md). Хендлы в карточку люди вписывают как попало
// (ссылка, @ник, голый id), а расширение отдаёт свой вид — если стороны
// разойдутся, панель не найдёт клиента.

describe("normalizeChatId — Telegram", () => {
  it("@username → username", () => {
    assert.equal(normalizeChatId("telegram", "@masha"), "masha")
  })
  it("ссылка t.me → username", () => {
    assert.equal(normalizeChatId("telegram", "https://t.me/masha"), "masha")
  })
  it("URL веб-клиента с хэшем → username", () => {
    assert.equal(normalizeChatId("telegram", "https://web.telegram.org/k/#@masha"), "masha")
  })
  it("регистр не значим", () => {
    assert.equal(normalizeChatId("telegram", "Masha"), "masha")
  })
  it("числовой peer id сохраняется как есть", () => {
    assert.equal(normalizeChatId("telegram", "123456789"), "123456789")
  })
  it("хвост после слэша отбрасывается", () => {
    assert.equal(normalizeChatId("telegram", "t.me/masha/42"), "masha")
  })
})

describe("normalizeChatId — VK", () => {
  it("ссылка на профиль → id", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/id12345"), "id12345")
  })
  it("короткое имя из ссылки", () => {
    assert.equal(normalizeChatId("vk", "vk.com/durov"), "durov")
  })
  it("query-хвост отбрасывается", () => {
    assert.equal(normalizeChatId("vk", "vk.com/durov?w=wall1_1"), "durov")
  })
  it("домен vk.ru тоже понимается", () => {
    assert.equal(normalizeChatId("vk", "https://vk.ru/durov"), "durov")
  })
})

describe("normalizeChatId — WhatsApp", () => {
  it("JID вида <номер>@c.us → ключ последних 10 цифр", () => {
    assert.equal(normalizeChatId("whatsapp", "79991234567@c.us"), "9991234567")
  })
  it("форматированный номер даёт тот же ключ", () => {
    assert.equal(normalizeChatId("whatsapp", "+7 (999) 123-45-67"), "9991234567")
  })
  it("восьмёрка и семёрка сводятся к одному ключу", () => {
    assert.equal(
      normalizeChatId("whatsapp", "89991234567"),
      normalizeChatId("whatsapp", "79991234567"),
    )
  })
  it("LID сохраняется отдельным видом — номера за ним нет", () => {
    assert.equal(normalizeChatId("whatsapp", "123456789012@lid"), "lid:123456789012")
  })
})

describe("normalizeChatId — MAX", () => {
  it("номер телефона сводится к ключу последних 10 цифр", () => {
    assert.equal(normalizeChatId("max", "+7 999 123-45-67"), "9991234567")
  })
  it("не-номер остаётся как есть в нижнем регистре", () => {
    assert.equal(normalizeChatId("max", "SomeId"), "someid")
  })
})

describe("normalizeChatId — пустые значения", () => {
  it("null → null", () => {
    assert.equal(normalizeChatId("telegram", null), null)
  })
  it("пробелы → null", () => {
    assert.equal(normalizeChatId("telegram", "   "), null)
  })
  it("голая собака → null", () => {
    assert.equal(normalizeChatId("telegram", "@"), null)
  })
})

describe("normalizeHandle — карточка и чат сходятся", () => {
  it("хендл из карточки ссылкой матчится с @ником из чата", () => {
    assert.equal(
      normalizeHandle("telegram", "https://t.me/Masha"),
      normalizeChatId("telegram", "@masha"),
    )
  })
  it("хендл ВК ссылкой матчится с id из URL диалога", () => {
    assert.equal(normalizeHandle("vk", "https://vk.com/id777"), normalizeChatId("vk", "id777"))
  })
})

describe("вспомогательные", () => {
  it("поле карточки по каналу", () => {
    assert.equal(handleFieldForChannel("telegram"), "telegram")
    assert.equal(handleFieldForChannel("vk"), "vk")
    assert.equal(handleFieldForChannel("max"), "max")
    // У WhatsApp отдельного поля нет — там матч по телефону клиента.
    assert.equal(handleFieldForChannel("whatsapp"), null)
  })
  it("ключ дедупликации включает чат: id сообщения уникален лишь внутри чата", () => {
    assert.equal(buildMessageExternalId("masha", "42"), "masha:42")
    assert.notEqual(buildMessageExternalId("masha", "42"), buildMessageExternalId("petya", "42"))
  })
  it("распознаём только каналы мессенджеров", () => {
    assert.equal(isMessengerChannel("telegram"), true)
    assert.equal(isMessengerChannel("internal"), false)
    assert.equal(isMessengerChannel("phone"), false)
  })
})
