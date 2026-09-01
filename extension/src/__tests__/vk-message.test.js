import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  VK_KEY_VERSION,
  buildMessageSentAt,
  buildVkActivityKey,
  buildVkMessageId,
  decideDirection,
  parseAuthorPeerId,
  parseClock,
  parseSeparatorDate,
} from "../common/vk-message.js"

// Разбор строки ленты ВК. Всё — по разметке, снятой probe 01.09.2026
// (docs/messenger-extension.md §8): классов направления у ВК нет, автор виден по
// маске аватара, время собирается из разделителя дня и часов строки.

describe("parseAuthorPeerId", () => {
  it("сообщество — отрицательный peer id из маски аватара", () => {
    assert.equal(parseAuthorPeerId('url("#mePeerFrameOffline36Mask-137130907")'), "-137130907")
  })
  it("человек — положительный", () => {
    assert.equal(parseAuthorPeerId("url(#mePeerFrameOnline48Mask448075672)"), "448075672")
  })
  it("голый id обрезки тоже понимаем", () => {
    assert.equal(parseAuthorPeerId("mePeerFrameOffline36Mask-137130907"), "-137130907")
  })
  it("мусор и пустота — null", () => {
    assert.equal(parseAuthorPeerId(""), null)
    assert.equal(parseAuthorPeerId(null), null)
    assert.equal(parseAuthorPeerId("url(#someOtherThing)"), null)
  })
})

describe("decideDirection", () => {
  it("автор совпал с собеседником — входящее", () => {
    assert.equal(
      decideDirection({ authorPeerId: "448075672", chatPeerId: "448075672" }),
      "incoming",
    )
  })

  it("сообщения сообщества: пишем мы, автор — само сообщество", () => {
    assert.equal(
      decideDirection({ authorPeerId: "-137130907", chatPeerId: "448075672" }),
      "outgoing",
    )
  })

  it("ЛИЧНЫЕ сообщения: наш аккаунт такой же положительный, как родитель", () => {
    // Замок на мине: по знаку peer id вся исходящая переписка личного чата
    // стала бы входящей — ответы администратора легли бы в карточку как слова
    // клиента. Спасает только сравнение с ключом чата.
    assert.equal(
      decideDirection({ authorPeerId: "53305026", chatPeerId: "704773753" }),
      "outgoing",
    )
    assert.equal(
      decideDirection({ authorPeerId: "704773753", chatPeerId: "704773753" }),
      "incoming",
    )
  })

  it("без ключа чата остаётся знак — верно для сообщений сообщества", () => {
    assert.equal(decideDirection({ authorPeerId: "-137130907" }), "outgoing")
    assert.equal(decideDirection({ authorPeerId: "448075672" }), "incoming")
  })

  it("peer id важнее галочек: они у своих, но признак автора надёжнее", () => {
    assert.equal(
      decideDirection({ authorPeerId: "448075672", chatPeerId: "448075672", hasReadStatus: true }),
      "incoming",
    )
  })

  it("автора не видно, но есть галочки прочтения — своё", () => {
    assert.equal(decideDirection({ hasReadStatus: true }), "outgoing")
  })

  it("серия подряд: автор скрыт, направление наследуется от строки выше", () => {
    assert.equal(decideDirection({ previousDirection: "incoming" }), "incoming")
    assert.equal(decideDirection({ previousDirection: "outgoing" }), "outgoing")
  })

  it("признаков нет вовсе — null, такую строку заливать нельзя", () => {
    assert.equal(decideDirection({}), null)
    assert.equal(decideDirection({ previousDirection: null }), null)
  })
})

describe("parseSeparatorDate", () => {
  const now = new Date(2026, 8, 1, 12, 0, 0)

  it("полная дата с годом — как её даёт aria-label разделителя", () => {
    assert.deepEqual(parseSeparatorDate("25 апреля 2025", now), { year: 2025, month: 3, day: 25 })
  })
  it("без года — берём текущий", () => {
    assert.deepEqual(parseSeparatorDate("16 января", now), { year: 2026, month: 0, day: 16 })
  })
  it("«Сегодня» и «Вчера»", () => {
    assert.deepEqual(parseSeparatorDate("Сегодня", now), { year: 2026, month: 8, day: 1 })
    assert.deepEqual(parseSeparatorDate("Вчера", now), { year: 2026, month: 7, day: 31 })
  })
  it("несуществующая дата не превращается молча в другую", () => {
    // JS сам переносит 31 февраля на март — в ленте это была бы выдуманная дата.
    assert.equal(parseSeparatorDate("31 февраля 2025", now), null)
  })
  it("мусор — null, а не выдуманная дата", () => {
    assert.equal(parseSeparatorDate("", now), null)
    assert.equal(parseSeparatorDate("Непрочитанные", now), null)
    assert.equal(parseSeparatorDate("25 мартобря 2025", now), null)
  })
})

describe("parseClock", () => {
  it("часы строки", () => {
    assert.deepEqual(parseClock("12:24"), { hours: 12, minutes: 24 })
  })
  it("невозможное время отбрасывается", () => {
    assert.equal(parseClock("25:70"), null)
    assert.equal(parseClock("нет времени"), null)
  })
})

describe("buildMessageSentAt", () => {
  const now = new Date(2026, 8, 1, 12, 0, 0)

  it("дата разделителя + часы строки", () => {
    const iso = buildMessageSentAt({ separator: "21 августа 2026", clock: "16:07", now })
    const stamp = new Date(String(iso))
    assert.equal(stamp.getFullYear(), 2026)
    assert.equal(stamp.getMonth(), 7)
    assert.equal(stamp.getDate(), 21)
    assert.equal(stamp.getHours(), 16)
    assert.equal(stamp.getMinutes(), 7)
  })

  it("нет одной половины — нет времени: «когда-то в 16:07» в ленту не ставим", () => {
    assert.equal(buildMessageSentAt({ separator: null, clock: "16:07", now }), null)
    assert.equal(buildMessageSentAt({ separator: "21 августа 2026", clock: null, now }), null)
  })
})

describe("buildVkMessageId", () => {
  const base = {
    chatId: "448075672",
    direction: /** @type {const} */ ("incoming"),
    sentAt: "2026-08-21T13:07:00.000Z",
    text: "Пишу",
  }

  it("ключ детерминирован: повторное чтение той же строки даёт то же значение", () => {
    assert.equal(buildVkMessageId(base), buildVkMessageId({ ...base }))
  })

  it("несёт версию схемы — по ней возможна разовая чистка одним запросом", () => {
    assert.ok(String(buildVkMessageId(base)).startsWith(`${VK_KEY_VERSION}-`))
  })

  it("лишние пробелы в тексте ключ не меняют", () => {
    assert.equal(buildVkMessageId(base), buildVkMessageId({ ...base, text: "  Пишу  " }))
  })

  it("разные чаты, направления, время и текст дают разные ключи", () => {
    const keys = new Set([
      buildVkMessageId(base),
      buildVkMessageId({ ...base, chatId: "335368817" }),
      buildVkMessageId({ ...base, direction: "outgoing" }),
      buildVkMessageId({ ...base, sentAt: "2026-08-22T13:07:00.000Z" }),
      buildVkMessageId({ ...base, text: "Пишу." }),
    ])
    assert.equal(keys.size, 5)
  })

  it("без времени ключа нет — иначе карточка получала бы копию переписки", () => {
    assert.equal(buildVkMessageId({ ...base, sentAt: null }), null)
  })

  it("без текста и без чата ключа тоже нет", () => {
    assert.equal(buildVkMessageId({ ...base, text: "" }), null)
    assert.equal(buildVkMessageId({ ...base, chatId: "" }), null)
  })

  it("границы полей не подделать перестановкой", () => {
    // Классическая дыра склейки: «a|b» и «ab|» не должны совпасть.
    assert.notEqual(
      buildVkMessageId({ ...base, text: "Пишу", chatId: "448075672" }),
      buildVkMessageId({ ...base, text: "ишу", chatId: "448075672П" }),
    )
  })
})

describe("buildVkActivityKey", () => {
  it("меняется, когда приходит новое сообщение", () => {
    const before = buildVkActivityKey({ direction: "incoming", clock: "13:07", text: "Пишу" })
    const after = buildVkActivityKey({ direction: "incoming", clock: "13:09", text: "И ещё" })
    assert.notEqual(before, after)
  })

  it("времени не требует: сигнал активности ничего не записывает", () => {
    assert.ok(buildVkActivityKey({ direction: "incoming", text: "Пишу" }))
  })

  it("пустая строка отпечатка не даёт", () => {
    assert.equal(buildVkActivityKey({ direction: "incoming", text: "" }), null)
  })
})
