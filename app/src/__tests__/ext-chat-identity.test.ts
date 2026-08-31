import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildMessageExternalId,
  handleFieldForChannel,
  isLocalMessageId,
  isMessengerChannel,
  isPositiveNumericChatId,
  normalizeChatId,
  normalizeHandle,
  parseMessageSentAt,
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

// Время сообщения. Главное здесь — разница между undefined и null: Prisma по
// undefined оставляет дефолт колонки (now()), а по null пишет в базу NULL.
// Именно на этом сломалась заливка: адаптер Telegram WebA машинного времени не
// видит и штатно шлёт null, и вся его переписка легла в CRM без времени —
// в лентах такие строки проваливаются в конец истории, в панели всплывают вверх.
describe("parseMessageSentAt", () => {
  it("нет времени → undefined, а НЕ null: сработает дефолт now()", () => {
    assert.equal(parseMessageSentAt(null), undefined)
    assert.equal(parseMessageSentAt(undefined), undefined)
  })
  it("ISO-строка разбирается", () => {
    const d = parseMessageSentAt("2026-08-27T10:14:00.000Z")
    assert.equal(d?.toISOString(), "2026-08-27T10:14:00.000Z")
  })
  it("unix-секунды (так отдаёт WhatsApp Store)", () => {
    const d = parseMessageSentAt(1756289640)
    assert.equal(d?.getTime(), 1756289640 * 1000)
  })
  it("unix-миллисекунды тоже понимаем", () => {
    const d = parseMessageSentAt(1756289640000)
    assert.equal(d?.getTime(), 1756289640000)
  })
  it("мусор не выдумываем", () => {
    assert.equal(parseMessageSentAt("вчера в 10:14"), undefined)
    assert.equal(parseMessageSentAt(""), undefined)
    assert.equal(parseMessageSentAt("   "), undefined)
    assert.equal(parseMessageSentAt(Number.NaN), undefined)
    assert.equal(parseMessageSentAt(0), undefined)
    assert.equal(parseMessageSentAt(-5), undefined)
  })
})
describe("isPositiveNumericChatId — что можно канонизировать", () => {
  it("личный чат Telegram: положительное число", () => {
    assert.equal(isPositiveNumericChatId("987654321"), true)
  })
  it("группа/канал со знаком минус — НЕЛЬЗЯ", () => {
    // Арифметика клиентов там расходится, а отличить базовую группу от
    // супергруппы по одному числу невозможно.
    assert.equal(isPositiveNumericChatId("-1001234567890"), false)
  })
  it("ноль — это NULL_PEER_ID, не идентификатор", () => {
    assert.equal(isPositiveNumericChatId("0"), false)
  })
  it("ник — не число", () => {
    assert.equal(isPositiveNumericChatId("masha"), false)
  })
  it("пусто", () => {
    assert.equal(isPositiveNumericChatId(null), false)
    assert.equal(isPositiveNumericChatId(undefined), false)
  })
})

describe("isLocalMessageId — второй рубеж против неотправленных", () => {
  it("временный дробный id", () => {
    // Старые сборки расширения в браузерах сотрудников ещё какое-то время
    // шлют такие id: сообщение легло бы в карточку второй строкой.
    assert.equal(isLocalMessageId("222237.0001"), true)
  })
  it("обычный id", () => {
    assert.equal(isLocalMessageId("222237"), false)
  })
  it("пусто", () => {
    assert.equal(isLocalMessageId(null), false)
    assert.equal(isLocalMessageId(""), false)
  })
})
