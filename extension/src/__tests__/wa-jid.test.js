import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isPersonalChatJid,
  normalizeJid,
  parseJid,
  parseMessageKey,
  phoneFromJid,
} from "../common/wa-jid.js"

// Разбор идентификаторов — фундамент канала: из data-id берётся и чат (значит,
// в чью карточку ляжет переписка), и id сообщения (значит, ключ дедупа). Ошибка
// здесь необратима: уникальный ключ не даёт переписать уже записанное.

describe("parseJid", () => {
  it("личный чат", () => {
    assert.deepEqual(parseJid("79001234567@c.us"), {
      user: "79001234567",
      device: null,
      server: "c.us",
      kind: "user",
    })
  })
  it("суффикс устройства отрезается", () => {
    // Один и тот же собеседник приходит и с суффиксом (сообщение с другого
    // устройства), и без. Не отрезать = два разных чата в CRM.
    assert.equal(parseJid("79001234567:12@c.us")?.user, "79001234567")
    assert.equal(parseJid("79001234567:12@c.us")?.device, "12")
  })
  it("s.whatsapp.net — тот же вид, что c.us", () => {
    assert.equal(parseJid("79001234567@s.whatsapp.net")?.kind, "user")
  })
  it("виды серверов различаются", () => {
    assert.equal(parseJid("123456789@lid")?.kind, "lid")
    assert.equal(parseJid("120363123456789012@g.us")?.kind, "group")
    assert.equal(parseJid("status@broadcast")?.kind, "broadcast")
    assert.equal(parseJid("12345@newsletter")?.kind, "newsletter")
    assert.equal(parseJid("12345@bot")?.kind, "bot")
  })
  it("не JID — null", () => {
    assert.equal(parseJid("79001234567"), null)
    assert.equal(parseJid("@c.us"), null)
    assert.equal(parseJid("79001234567@"), null)
    assert.equal(parseJid(""), null)
    assert.equal(parseJid(null), null)
  })
})

describe("isPersonalChatJid", () => {
  it("личный чат и LID обслуживаем", () => {
    assert.equal(isPersonalChatJid("79001234567@c.us"), true)
    assert.equal(isPersonalChatJid("123456789@lid"), true)
  })
  it("группы, рассылки, статусы и каналы — нет", () => {
    // За таким чатом стоит не один человек. Записать его переписку в карточку
    // одного клиента нельзя, и убрать её оттуда потом нечем.
    assert.equal(isPersonalChatJid("120363123456789012@g.us"), false)
    assert.equal(isPersonalChatJid("status@broadcast"), false)
    assert.equal(isPersonalChatJid("1234567890@broadcast"), false)
    assert.equal(isPersonalChatJid("12345@newsletter"), false)
    assert.equal(isPersonalChatJid("12345@bot"), false)
  })
  it("служебные аккаунты WhatsApp — нет", () => {
    assert.equal(isPersonalChatJid("0@c.us"), false)
    assert.equal(isPersonalChatJid("server@c.us"), false)
  })
})

describe("phoneFromJid", () => {
  it("номер берётся только из телефонного JID", () => {
    assert.equal(phoneFromJid("79001234567@c.us"), "79001234567")
    assert.equal(phoneFromJid("79001234567:3@s.whatsapp.net"), "79001234567")
  })
  it("из LID номер НЕ выводится", () => {
    // За LID стоит внутренний идентификатор WhatsApp. Обойтись с ним как с
    // телефоном — значит найти клиента по чужому номеру и подставить
    // постороннего человека без участия сотрудника.
    assert.equal(phoneFromJid("123456789012@lid"), null)
  })
  it("из группы и рассылки — тоже нет", () => {
    assert.equal(phoneFromJid("120363123456789012@g.us"), null)
    assert.equal(phoneFromJid("status@broadcast"), null)
  })
  it("нецифровая локальная часть — не номер", () => {
    assert.equal(phoneFromJid("server@c.us"), null)
  })
})

describe("normalizeJid", () => {
  it("сводит формы одного чата к одной", () => {
    assert.equal(normalizeJid("79001234567@s.whatsapp.net"), "79001234567@c.us")
    assert.equal(normalizeJid("79001234567:12@c.us"), "79001234567@c.us")
    assert.equal(normalizeJid("79001234567@C.US"), "79001234567@c.us")
  })
})

describe("parseMessageKey", () => {
  it("упакованный ключ: направление, чат, id", () => {
    assert.deepEqual(parseMessageKey("false_79001234567@c.us_3EB0C767D26B8DA0F1A2"), {
      fromMe: false,
      chatJid: "79001234567@c.us",
      messageId: "3EB0C767D26B8DA0F1A2",
      participant: null,
      shape: "key",
    })
  })
  it("исходящее опознаётся по первому сегменту", () => {
    assert.equal(parseMessageKey("true_79001234567@c.us_ABC12345")?.fromMe, true)
  })
  it("участник группы — в последнем сегменте", () => {
    const key = parseMessageKey("false_120363123456789012@g.us_ABC12345_79007654321@c.us")
    assert.equal(key?.chatJid, "120363123456789012@g.us")
    assert.equal(key?.participant, "79007654321@c.us")
  })
  it("«Сообщения себе»: четвёртый сегмент — это self, а не участник", () => {
    // Слепое правило «четвёртый сегмент = участник» ошибается ровно здесь:
    // MsgKey дописывает self («in»/«out») ПЕРЕД участником.
    const key = parseMessageKey("true_79001234567@c.us_ABC12345_out")
    assert.equal(key?.participant, null)
    assert.equal(key?.messageId, "ABC12345")

    const both = parseMessageKey("true_79001234567@c.us_ABC12345_out_79001234567@c.us")
    assert.equal(both?.participant, "79001234567@c.us")
  })
  it("суффикс устройства в чате нормализуется", () => {
    // Иначе ключ дедупа поедет: тот же чат то с суффиксом, то без — и вся
    // переписка задвоится.
    assert.equal(parseMessageKey("false_79001234567:12@c.us_ABC12345")?.chatJid, "79001234567@c.us")
  })
  it("голый id принимается отдельным видом", () => {
    // Полевые наблюдения весны 2026 говорят, что data-id может приходить одним
    // лишь id. Код бандла этого не подтверждает, но поддержать оба вида дёшево.
    const key = parseMessageKey("3EB00298006A5DC1795156")
    assert.equal(key?.shape, "bare")
    assert.equal(key?.chatJid, null)
    assert.equal(key?.fromMe, null)
    assert.equal(key?.messageId, "3EB00298006A5DC1795156")
  })
  it("лишние сегменты не ломают разбор", () => {
    // Зеркалим парсер самого WhatsApp: первые три сегмента берутся безусловно.
    // Строгая проверка «ровно 3–5 сегментов» выбросила бы такое сообщение
    // целиком — например, если идентификатор пришёл от стороннего клиента и
    // содержит подчёркивание.
    const key = parseMessageKey("false_79001234567@c.us_ABC12345_out_79001234567@c.us_extra")
    assert.equal(key?.chatJid, "79001234567@c.us")
    assert.equal(key?.messageId, "ABC12345")
    assert.equal(key?.fromMe, false)
  })
  it("мусор не разбирается", () => {
    assert.equal(parseMessageKey(""), null)
    assert.equal(parseMessageKey(null), null)
    // Короткая строка на голый id не тянет — мусорный ключ дедупа хуже
    // пропущенного сообщения.
    assert.equal(parseMessageKey("abc"), null)
    // Первый сегмент обязан быть флагом направления.
    assert.equal(parseMessageKey("maybe_79001234567@c.us_ABC12345"), null)
    // Чат обязан быть JID.
    assert.equal(parseMessageKey("false_79001234567_ABC12345"), null)
  })
})
