import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_KEY_VERSION,
  buildMaxActivityKey,
  buildMaxMessageId,
  isServiceLine,
} from "../common/max-message.js"

// В разметке MAX нет ни id сообщения, ни машинного времени, а звонки рисуются в
// ленте обычным текстом. Поэтому ключ дедупа синтетический, а служебные строки
// отсеиваются словарём — и то и другое обязано быть под тестами.

describe("isServiceLine", () => {
  it("строки звонков из живого прогона", () => {
    assert.equal(isServiceLine("Отменённый вызов Видео"), true)
    assert.equal(isServiceLine("Пропущенный вызов Аудио"), true)
    assert.equal(isServiceLine("Исходящий вызов"), true)
    assert.equal(isServiceLine("Входящий вызов Аудио 1:05"), true)
  })

  it("«е» вместо «ё» и регистр не мешают", () => {
    assert.equal(isServiceLine("отмененный вызов видео"), true)
    assert.equal(isServiceLine("ЗАВЕРШЁННЫЙ ЗВОНОК"), true)
  })

  it("видеовызов одним словом", () => {
    assert.equal(isServiceLine("Видеовызов"), true)
    assert.equal(isServiceLine("Аудио-звонок"), true)
  })

  it("лишние пробелы и переносы не спасают строку от отсева", () => {
    assert.equal(isServiceLine("  Пропущенный   вызов\nАудио "), true)
  })

  // Главный риск словаря — съесть настоящее сообщение родителя. Поэтому
  // сверяем строку ЦЕЛИКОМ, а не по вхождению слова.
  it("сообщение человека со словом «вызов» остаётся сообщением", () => {
    assert.equal(isServiceLine("пропущенный вызов, перезвоните пожалуйста"), false)
    assert.equal(isServiceLine("Вызов принят, спасибо!"), false)
    assert.equal(isServiceLine("Звонок был не от нас"), false)
    assert.equal(isServiceLine("вызов"), true) // голое слово — это лента MAX
  })

  it("пустая строка служебной не считается", () => {
    assert.equal(isServiceLine(""), false)
    assert.equal(isServiceLine(null), false)
    assert.equal(isServiceLine(undefined), false)
  })
})

describe("buildMaxMessageId", () => {
  const base = {
    chatId: "437719203",
    direction: /** @type {const} */ ("incoming"),
    sentAt: "2026-07-02T13:15:00.000Z",
    text: "Здравствуйте, а завтра занятие будет?",
  }

  it("ключ детерминирован: то же сообщение — тот же ключ", () => {
    assert.equal(buildMaxMessageId(base), buildMaxMessageId({ ...base }))
  })

  it("версия в ключе — по ней делается разовая чистка одним запросом", () => {
    assert.ok(buildMaxMessageId(base)?.startsWith(`${MAX_KEY_VERSION}-`))
  })

  it("перерисовка с другими пробелами ключ не меняет — иначе дубль в карточке", () => {
    assert.equal(
      buildMaxMessageId(base),
      buildMaxMessageId({ ...base, text: `  ${base.text.replace(" ", "\n ")}  ` }),
    )
  })

  it("разный чат, направление, время или текст — разные ключи", () => {
    const key = buildMaxMessageId(base)
    assert.notEqual(key, buildMaxMessageId({ ...base, chatId: "437719204" }))
    assert.notEqual(key, buildMaxMessageId({ ...base, direction: "outgoing" }))
    assert.notEqual(key, buildMaxMessageId({ ...base, sentAt: "2026-07-02T13:16:00.000Z" }))
    assert.notEqual(key, buildMaxMessageId({ ...base, text: base.text + "?" }))
  })

  it("границу полей не подделать переносом текста в соседнее поле", () => {
    assert.notEqual(
      buildMaxMessageId({ ...base, chatId: "1", text: "2 привет" }),
      buildMaxMessageId({ ...base, chatId: "12", text: "привет" }),
    )
  })

  // Гард: без разобранного времени ключ станет недетерминированным, и карточка
  // будет получать копию переписки при каждом открытии чата.
  it("без времени ключа нет", () => {
    assert.equal(buildMaxMessageId({ ...base, sentAt: null }), null)
    assert.equal(buildMaxMessageId({ ...base, sentAt: "" }), null)
  })

  it("без чата и без текста ключа нет", () => {
    assert.equal(buildMaxMessageId({ ...base, chatId: "" }), null)
    assert.equal(buildMaxMessageId({ ...base, text: "   " }), null)
  })

  it("длинный текст не ломает хеш", () => {
    const long = "а".repeat(5000)
    const key = buildMaxMessageId({ ...base, text: long })
    assert.ok(key)
    assert.notEqual(key, buildMaxMessageId({ ...base, text: long + "б" }))
  })
})

describe("buildMaxActivityKey", () => {
  it("время необязательно: сигнал активности ничего не записывает", () => {
    const key = buildMaxActivityKey({ direction: "incoming", clock: null, text: "привет" })
    assert.ok(key)
  })

  it("новое сообщение меняет отпечаток", () => {
    const before = buildMaxActivityKey({ direction: "incoming", clock: "16:15", text: "привет" })
    const after = buildMaxActivityKey({ direction: "incoming", clock: "16:16", text: "ещё" })
    assert.notEqual(before, after)
  })

  it("перерисовка того же сообщения отпечаток не меняет", () => {
    assert.equal(
      buildMaxActivityKey({ direction: "outgoing", clock: "16:15", text: "привет" }),
      buildMaxActivityKey({ direction: "outgoing", clock: " 16:15 ", text: " привет " }),
    )
  })

  it("пустой чат — отпечатка нет", () => {
    assert.equal(buildMaxActivityKey({ direction: "incoming", clock: "", text: "" }), null)
  })
})
