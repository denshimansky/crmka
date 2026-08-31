import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  chooseCanonicalChatId,
  decideBindingLink,
  planCommunicationKeyRepair,
  splitChatIds,
} from "@/lib/ext/chat-canonical"
import { buildMessageExternalId } from "@/lib/ext/chat-identity"

// Канон чата решает, под каким ключом лежит переписка. Ошибка здесь НЕОБРАТИМА:
// чужие сообщения оседают в карточке клиента, а уникальный ключ не даёт их
// переписать. Поэтому правило зафиксировано тестами целиком.

describe("chooseCanonicalChatId — telegram", () => {
  it("из мешка берём положительное число", () => {
    assert.equal(chooseCanonicalChatId("telegram", ["masha", "987654321"]), "987654321")
  })
  it("порядок в мешке не важен", () => {
    assert.equal(chooseCanonicalChatId("telegram", ["987654321", "masha"]), "987654321")
  })
  it("числа нет — остаётся ник", () => {
    assert.equal(chooseCanonicalChatId("telegram", ["masha"]), "masha")
  })
  it("ЗАМОК: отрицательные (группы и каналы) не канонизируем", () => {
    // У WebK это «-rawId», у WebA «-(10^12 + rawId)», и отличить базовую группу
    // от супергруппы по одному числу нельзя. Соблазн «дописать 10^12» положил бы
    // переписку одного чата в карточку другого.
    assert.equal(chooseCanonicalChatId("telegram", ["-1001234567890"]), "-1001234567890")
    assert.equal(
      chooseCanonicalChatId("telegram", ["-1001234567890", "-1234567890"]),
      "-1001234567890",
    )
  })
  it("пустой вход", () => {
    assert.equal(chooseCanonicalChatId("telegram", []), null)
  })
})

describe("chooseCanonicalChatId — остальные каналы", () => {
  it("поведение не меняется: берём первый", () => {
    assert.equal(chooseCanonicalChatId("whatsapp", ["9991234567", "lid:42"]), "9991234567")
    assert.equal(chooseCanonicalChatId("vk", ["durov", "1"]), "durov")
    assert.equal(chooseCanonicalChatId("max", ["9991234567"]), "9991234567")
  })
})

describe("splitChatIds", () => {
  it("нормализует, дедуплицирует и делит на канон и алиасы", () => {
    const result = splitChatIds("telegram", ["@masha", "987654321", "https://t.me/masha"])
    assert.equal(result.canonical, "987654321")
    assert.deepEqual(result.aliases, ["masha"])
    assert.deepEqual(result.all, ["987654321", "masha"])
  })
  it("канон не попадает в алиасы", () => {
    const result = splitChatIds("telegram", ["987654321", "987654321"])
    assert.deepEqual(result.aliases, [])
  })
  it("пустой вход", () => {
    const result = splitChatIds("telegram", [null, undefined, ""])
    assert.equal(result.canonical, null)
    assert.deepEqual(result.all, [])
  })
})

describe("decideBindingLink", () => {
  const row = (clientId: string, externalChatId: string, canonicalChatId: string | null = null) => ({
    clientId,
    externalChatId,
    canonicalChatId,
  })

  it("привязка есть по нику, канона нет — достраиваем", () => {
    assert.equal(
      decideBindingLink({ rows: [row("c1", "masha")], canonical: "987654321" }),
      "link",
    )
  })
  it("разные клиенты — конфликт, молча не выбираем", () => {
    assert.equal(
      decideBindingLink({ rows: [row("c1", "masha"), row("c2", "987654321")], canonical: "987654321" }),
      "conflict",
    )
  })
  it("вся группа уже помечена каноном — делать нечего", () => {
    assert.equal(
      decideBindingLink({
        rows: [row("c1", "masha", "987654321"), row("c1", "987654321", "987654321")],
        canonical: "987654321",
      }),
      "noop",
    )
  })
  it("канон есть, но группа не помечена — дометим", () => {
    assert.equal(
      decideBindingLink({
        rows: [row("c1", "masha"), row("c1", "987654321")],
        canonical: "987654321",
      }),
      "link",
    )
  })
  it("привязок нет вовсе", () => {
    assert.equal(decideBindingLink({ rows: [], canonical: "987654321" }), "noop")
  })
})

describe("planCommunicationKeyRepair", () => {
  const CANON = "987654321"
  const ALIAS = "masha"
  const base = {
    canonical: CANON,
    aliases: [ALIAS],
    buildKey: buildMessageExternalId,
  }
  const msg = (externalId: string, content: string | null, sentAt: Date | null = null) => ({
    externalId,
    content,
    sentAt,
  })
  const existing = (
    id: string,
    chatId: string,
    messageId: string,
    content: string | null,
    sentAtSource: string | null = null,
  ) => ({ id, externalId: buildMessageExternalId(chatId, messageId), content, sentAtSource })

  it("сообщения нет нигде — вставляем", () => {
    const plan = planCommunicationKeyRepair({ ...base, messages: [msg("1", "привет")], existing: [] })
    assert.equal(plan.insert.length, 1)
    assert.equal(plan.rename.length, 0)
  })

  it("лежит под каноном — ничего не делаем", () => {
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет")],
      existing: [existing("row1", CANON, "1", "привет")],
    })
    assert.equal(plan.insert.length, 0)
    assert.equal(plan.rename.length, 0)
    assert.equal(plan.deleteDuplicate.length, 0)
  })

  it("лежит только под алиасом — ПЕРЕИМЕНОВЫВАЕМ, не вставляем", () => {
    // Переименование сохраняет время, автора и место строки в ленте; «вставить
    // и удалить» потеряло бы всё это.
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет")],
      existing: [existing("row1", ALIAS, "1", "привет")],
    })
    assert.equal(plan.insert.length, 0)
    assert.deepEqual(plan.rename, [
      {
        id: "row1",
        fromExternalId: buildMessageExternalId(ALIAS, "1"),
        toExternalId: buildMessageExternalId(CANON, "1"),
      },
    ])
  })

  it("есть оба и текст совпал — алиасного близнеца убираем", () => {
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет")],
      existing: [existing("row1", CANON, "1", "привет"), existing("row2", ALIAS, "1", "привет")],
    })
    assert.deepEqual(plan.deleteDuplicate, [
      { id: "row2", externalId: buildMessageExternalId(ALIAS, "1") },
    ])
    assert.equal(plan.conflicts, 0)
  })

  it("есть оба, но текст РАЗНЫЙ — не трогаем ничего", () => {
    // Страховка от кривого канона: если число снято неверно, тексты не совпадут
    // и мы не удалим чужую строку.
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет")],
      existing: [existing("row1", CANON, "1", "привет"), existing("row2", ALIAS, "1", "другое")],
    })
    assert.equal(plan.deleteDuplicate.length, 0)
    assert.equal(plan.conflicts, 1)
  })

  it("приехало настоящее время вместо времени заливки — обновляем", () => {
    const when = new Date("2026-08-30T10:15:00.000Z")
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет", when)],
      existing: [existing("row1", CANON, "1", "привет", "upload")],
    })
    assert.deepEqual(plan.refreshSentAt, [{ id: "row1", sentAt: when }])
  })

  it("настоящее время уже стоит — не трогаем", () => {
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет", new Date("2026-08-30T10:15:00.000Z"))],
      existing: [existing("row1", CANON, "1", "привет", "message")],
    })
    assert.equal(plan.refreshSentAt.length, 0)
  })

  it("идемпотентность: повторный прогон по результату первого пуст", () => {
    // После починки строка лежит под каноном — второй заход не должен ни
    // вставлять, ни переименовывать, ни удалять.
    const plan = planCommunicationKeyRepair({
      ...base,
      messages: [msg("1", "привет")],
      existing: [existing("row1", CANON, "1", "привет")],
    })
    assert.equal(plan.insert.length + plan.rename.length + plan.deleteDuplicate.length, 0)
  })
})
