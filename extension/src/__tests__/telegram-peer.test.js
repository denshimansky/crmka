import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildAltIds,
  isLocalMessageId,
  parseWebAMessageId,
  parseWebKMessageId,
  pickPeerId,
} from "../common/telegram-peer.js"

// Каноникализация собеседника — место, где ошибка НЕОБРАТИМА: чужая переписка
// оседает в карточке клиента, а ключ дедупа не даёт её переписать. Поэтому
// правило приёма числа зафиксировано тестами целиком, включая все отказы.

const composer = (value) => ({ source: "composer", value })
const bubble = (value) => ({ source: "bubble", value })
const avatar = (value) => ({ source: "avatar", value })
const title = (value) => ({ source: "title", value })

describe("pickPeerId — числовой хэш", () => {
  it("разметка подтверждает число из адреса", () => {
    const result = pickPeerId({ hashId: "123456789", sources: [composer("123456789")] })
    assert.equal(result.peerId, "123456789")
  })
  it("разметка молчит — канон не строим", () => {
    const result = pickPeerId({ hashId: "123456789", sources: [] })
    assert.equal(result.peerId, null)
  })
  it("разметка показывает ДРУГОЙ чат — отказ", () => {
    // Кадр перехода между диалогами: приняв число, мы залили бы переписку
    // нового чата в карточку прежнего собеседника.
    const result = pickPeerId({ hashId: "123456789", sources: [composer("987654321")] })
    assert.equal(result.peerId, null)
  })
})

describe("pickPeerId — хэш с ником", () => {
  it("два согласных источника, один опорный", () => {
    const result = pickPeerId({ hashId: "masha", sources: [composer("555"), avatar("555")] })
    assert.equal(result.peerId, "555")
  })
  it("одного источника мало", () => {
    const result = pickPeerId({ hashId: "masha", sources: [composer("555")] })
    assert.equal(result.peerId, null)
  })
  it("двух НЕопорных источников мало", () => {
    // Аватар и заголовок живут в шапке и в сайдбаре, где легко поймать
    // соседний диалог; чистого пира диалога несут только поле ввода и пузырь.
    const result = pickPeerId({ hashId: "masha", sources: [avatar("555"), title("555")] })
    assert.equal(result.peerId, null)
  })
  it("источники разошлись — отказ, а не «выберем большинство»", () => {
    const result = pickPeerId({
      hashId: "masha",
      sources: [composer("555"), avatar("555"), bubble("777"), title("777")],
    })
    assert.equal(result.peerId, null)
  })
  it("кадр перехода: в разметке ещё пир прошлого чата", () => {
    const result = pickPeerId({
      hashId: "masha",
      sources: [composer("111"), avatar("111")],
      previousPeerId: "111",
      chatSwitched: true,
    })
    assert.equal(result.peerId, null)
  })
  it("число только из разметки требует подтверждения вторым наблюдением", () => {
    // Адресная строка его не подтверждает, а на кадре перехода в разметке ещё
    // живёт пир прошлого чата. Подтверждение делает адаптер (telegram.js).
    const result = pickPeerId({ hashId: "masha", sources: [composer("555"), avatar("555")] })
    assert.equal(result.needsConfirmation, true)
  })
  it("число из адресной строки подтверждать нечем — источник независимый", () => {
    const result = pickPeerId({ hashId: "555", sources: [composer("555")] })
    assert.equal(result.needsConfirmation, false)
  })
  it("тот же чат, канон повторно — принимаем", () => {
    const result = pickPeerId({
      hashId: "masha",
      sources: [composer("111"), avatar("111")],
      previousPeerId: "111",
      chatSwitched: false,
    })
    assert.equal(result.peerId, "111")
  })
})

describe("pickPeerId — что канонизировать НЕЛЬЗЯ", () => {
  it("группа: отрицательный id", () => {
    // ЗАМОК. У групп арифметика клиентов расходится (WebK «-rawId», WebA
    // «-(10^12 + rawId)»), а отличить базовую группу от супергруппы по одному
    // числу нельзя. «Дописать 10^12» — прямой путь положить переписку одного
    // чата в карточку другого.
    const result = pickPeerId({
      hashId: "-1001234567890",
      sources: [composer("-1234567890"), bubble("-1234567890")],
    })
    assert.equal(result.peerId, null)
  })
  it("смешанные знаки — несогласованная разметка", () => {
    const result = pickPeerId({ hashId: "masha", sources: [composer("555"), bubble("-555")] })
    assert.equal(result.peerId, null)
  })
  it("NULL_PEER_ID нулём не считаем", () => {
    const result = pickPeerId({ hashId: "masha", sources: [composer("0"), avatar("0")] })
    assert.equal(result.peerId, null)
  })
  it("мусор вместо числа", () => {
    const result = pickPeerId({ hashId: "masha", sources: [composer("abc"), avatar("abc")] })
    assert.equal(result.peerId, null)
  })
  it("у отказа всегда есть причина — её показывает панель", () => {
    const result = pickPeerId({ hashId: "masha", sources: [] })
    assert.ok(result.reason.length > 0)
  })
})

describe("buildAltIds", () => {
  it("хэш и канон — оба, в стабильном порядке", () => {
    assert.deepEqual(buildAltIds({ hashId: "masha", peerId: "555" }), ["masha", "555"])
  })
  it("совпали — не задваиваем", () => {
    assert.deepEqual(buildAltIds({ hashId: "555", peerId: "555" }), ["555"])
  })
  it("канона нет — остаётся только хэш", () => {
    assert.deepEqual(buildAltIds({ hashId: "masha", peerId: null }), ["masha"])
  })
})

describe("isLocalMessageId", () => {
  it("дробный id — сообщение ещё не отправлено", () => {
    assert.equal(isLocalMessageId("222237.0001"), true)
  })
  it("обычный id", () => {
    assert.equal(isLocalMessageId("222237"), false)
  })
  it("пусто", () => {
    assert.equal(isLocalMessageId(null), false)
  })
})

describe("parseWebKMessageId", () => {
  it("обычный mid", () => {
    assert.equal(parseWebKMessageId("222236"), "222236")
  })
  it("временный mid не заливаем", () => {
    assert.equal(parseWebKMessageId("222237.0001"), null)
  })
})

describe("parseWebAMessageId", () => {
  it("приоритет у data-message-id", () => {
    assert.equal(parseWebAMessageId({ dataMessageId: "555", htmlId: "message-1234" }), "555")
  })
  it("html-id как фоллбэк", () => {
    assert.equal(parseWebAMessageId({ htmlId: "message-1234" }), "1234")
  })
  it("альбом — то же сообщение", () => {
    assert.equal(parseWebAMessageId({ htmlId: "message-1234-1" }), "1234")
  })
  it("локальное сообщение (ведущий ноль) не заливаем", () => {
    // Сегодня такой id отдавал «1234» — id ЧУЖОГО, реального сообщения.
    assert.equal(parseWebAMessageId({ htmlId: "message-1234-000001" }), null)
  })
  it("не наш элемент", () => {
    assert.equal(parseWebAMessageId({ htmlId: "album-1234" }), null)
  })
})
