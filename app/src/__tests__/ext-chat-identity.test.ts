import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  acceptsPhoneParam,
  buildMessageExternalId,
  handleFieldForChannel,
  isLocalMessageId,
  isMaxGroupChatId,
  isMessengerChannel,
  isPositiveNumericChatId,
  isUnsupportedChat,
  isVkUnsupportedChatId,
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

// ВК: собеседник лежит в параметре «sel», а НЕ в пути. Прежняя реализация
// разбирала адрес общим правилом (отрезать всё после «?»), и все диалоги
// сообщества схлопывались в один ключ — id этого сообщества, а все личные в
// «im». Уникальный индекс (tenantId, channel, external_chat_id) склеил бы их в
// одну привязку, и переписка всех родителей центра уехала бы в карточку первого
// привязанного клиента — необратимо. Тесты ниже и есть замок на этой мине;
// прежние фиксировали как раз сломанное поведение и заменены.
describe("normalizeChatId — VK", () => {
  // Живой факт 01.09.2026: у сообщества открывается новый VK Messenger, и
  // диалог назван в ПУТИ («/convo/<собеседник>»), а не параметром «sel».
  // Заочное предположение про sel этим прогоном опровергнуто; форма старого
  // интерфейса оставлена и проверяется ниже.
  it("живой адрес нового интерфейса → id собеседника, а не сообщества", () => {
    assert.equal(
      normalizeChatId("vk", "https://vk.ru/gim137130907/convo/335368817?entrypoint=list_all"),
      "335368817",
    )
  })
  it("два диалога одного сообщества в новом интерфейсе дают РАЗНЫЕ ключи", () => {
    assert.notEqual(
      normalizeChatId("vk", "https://vk.ru/gim137130907/convo/335368817"),
      normalizeChatId("vk", "https://vk.ru/gim137130907/convo/999888777"),
    )
  })
  it("«convo» без собеседника — диалог не выбран", () => {
    assert.equal(normalizeChatId("vk", "https://vk.ru/gim137130907/convo"), null)
  })
  it("беседа и сообщество ловятся и в новом интерфейсе", () => {
    assert.equal(normalizeChatId("vk", "https://vk.ru/gim137130907/convo/2000000045"), "c45")
    assert.equal(normalizeChatId("vk", "https://vk.ru/im/convo/-216789012"), "-216789012")
  })
  it("диалог в сообщениях сообщества (старый интерфейс) → id СОБЕСЕДНИКА", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/gim216789012?sel=45678901"), "45678901")
  })
  it("два разных диалога одного сообщества дают РАЗНЫЕ ключи", () => {
    const first = normalizeChatId("vk", "https://vk.com/gim216789012?sel=45678901")
    const second = normalizeChatId("vk", "https://vk.com/gim216789012?sel=99999999")
    assert.notEqual(first, second)
  })
  it("личные сообщения: собеседник из sel, а не «im»", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/im?sel=123456"), "123456")
  })
  it("старый ВК держал sel в хэше — понимаем и его", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/im#sel=123456"), "123456")
  })
  it("мессенджер открыт, диалог не выбран → null (привязывать нечего)", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/im"), null)
    assert.equal(normalizeChatId("vk", "https://vk.com/gim216789012"), null)
  })
  it("«id12345» и голое число — один и тот же человек", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/id12345"), "12345")
    assert.equal(normalizeChatId("vk", "12345"), "12345")
    assert.equal(normalizeChatId("vk", "id12345"), "12345")
  })
  it("короткое имя страницы — как есть, в нижнем регистре", () => {
    assert.equal(normalizeChatId("vk", "vk.com/durov"), "durov")
    assert.equal(normalizeChatId("vk", "https://vk.ru/Durov"), "durov")
  })
  it("хвост записи на стене не мешает читать короткое имя", () => {
    assert.equal(normalizeChatId("vk", "vk.com/durov?w=wall1_1"), "durov")
  })
  it("беседа приводится к «c<N>» из обеих форм записи", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/im?sel=c45"), "c45")
    // 2 000 000 045 — та же беседа №45 в кодировке peer_id из VK API.
    assert.equal(normalizeChatId("vk", "https://vk.com/im?sel=2000000045"), "c45")
  })
  it("сообщество приводится к «-<N>» из всех форм записи", () => {
    assert.equal(normalizeChatId("vk", "https://vk.com/im?sel=-216789012"), "-216789012")
    assert.equal(normalizeChatId("vk", "vk.com/club216789012"), "-216789012")
    assert.equal(normalizeChatId("vk", "vk.com/public216789012"), "-216789012")
  })
})

describe("isVkUnsupportedChatId", () => {
  it("беседа и сообщество — за чатом не один человек", () => {
    assert.equal(isVkUnsupportedChatId("c45"), true)
    assert.equal(isVkUnsupportedChatId("-216789012"), true)
  })
  it("человек — обслуживаем: и по числу, и по короткому имени", () => {
    assert.equal(isVkUnsupportedChatId("45678901"), false)
    assert.equal(isVkUnsupportedChatId("durov"), false)
    assert.equal(isVkUnsupportedChatId(null), false)
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

  // Мина, симметричная максовской (Шаг 0 Фазы 4): нераспознанный JID падал в
  // ветку «оставшиеся цифры — это телефон». Групповой чат превращался в ключ,
  // неотличимый от номера, resolve-client искал по нему клиента ПО ТЕЛЕФОНУ и
  // при единственном совпадении подставлял его САМ, без участия человека.
  it("групповой JID НЕ превращается в телефонный ключ", () => {
    assert.equal(normalizeChatId("whatsapp", "120363123456789012@g.us"), null)
    // Легаси-форма группового JID: «<создатель>-<время создания>@g.us».
    assert.equal(normalizeChatId("whatsapp", "79991234567-1600000000@g.us"), null)
  })
  it("рассылки, статусы и каналы тоже не опознаются", () => {
    assert.equal(normalizeChatId("whatsapp", "status@broadcast"), null)
    assert.equal(normalizeChatId("whatsapp", "1234567890@broadcast"), null)
    assert.equal(normalizeChatId("whatsapp", "12345@newsletter"), null)
  })
})

// Гард «панель этот чат не ведёт». Проверяется ПО СЫРОМУ идентификатору, до
// нормализации: у WhatsApp признак — суффикс JID, а нормализация его
// уничтожает. Рубеж серверный, потому что в браузере сотрудника какое-то время
// живёт старая сборка расширения, и клиентские рубежи её не переживают.
describe("isUnsupportedChat", () => {
  it("WhatsApp: группа, рассылка, статусы и канал", () => {
    assert.equal(isUnsupportedChat("whatsapp", "120363123456789012@g.us"), true)
    assert.equal(isUnsupportedChat("whatsapp", "status@broadcast"), true)
    assert.equal(isUnsupportedChat("whatsapp", "1234567890@broadcast"), true)
    assert.equal(isUnsupportedChat("whatsapp", "12345@newsletter"), true)
  })
  it("WhatsApp: личный чат и LID проходят", () => {
    assert.equal(isUnsupportedChat("whatsapp", "79991234567@c.us"), false)
    assert.equal(isUnsupportedChat("whatsapp", "79991234567@s.whatsapp.net"), false)
    assert.equal(isUnsupportedChat("whatsapp", "123456789012@lid"), false)
    assert.equal(isUnsupportedChat("whatsapp", "79991234567"), false)
  })
  it("MAX: групповой чат ловится и по адресу, и по голому id", () => {
    assert.equal(isUnsupportedChat("max", "-78377804395205"), true)
    assert.equal(isUnsupportedChat("max", "https://web.max.ru/-78377804395205"), true)
    assert.equal(isUnsupportedChat("max", "437719203"), false)
  })
  it("ВК: беседа и диалог с сообществом ловятся в любой форме записи", () => {
    assert.equal(isUnsupportedChat("vk", "https://vk.com/im?sel=c45"), true)
    assert.equal(isUnsupportedChat("vk", "https://vk.com/im?sel=2000000045"), true)
    assert.equal(isUnsupportedChat("vk", "https://vk.com/im?sel=-216789012"), true)
    assert.equal(isUnsupportedChat("vk", "vk.com/club216789012"), true)
    assert.equal(isUnsupportedChat("vk", "https://vk.com/gim216789012?sel=45678901"), false)
    assert.equal(isUnsupportedChat("vk", "vk.com/durov"), false)
  })
  it("Telegram не трогаем: там группы привязываются и работают", () => {
    assert.equal(isUnsupportedChat("telegram", "-1001234567890"), false)
  })
  it("пустое значение — не повод для отказа", () => {
    assert.equal(isUnsupportedChat("whatsapp", null), false)
    assert.equal(isUnsupportedChat("whatsapp", "   "), false)
  })
})

// MAX: chatId — это НЕ телефон, а длинное число из адреса. Прежняя реализация
// гнала его через phoneMatchKey и обрезала путь по первому «/» — обе ошибки вели
// к чужой переписке в карточке клиента, поэтому граница зафиксирована тестами.
describe("normalizeChatId — MAX", () => {
  it("длинный chatId НЕ обрезается до последних 10 цифр", () => {
    // Раньше «0123456789012» превращалось в «3456789012»: старшие разряды
    // терялись молча, а резолв искал по обрезку клиента ПО ТЕЛЕФОНУ.
    assert.equal(normalizeChatId("max", "https://web.max.ru/0123456789012"), "0123456789012")
  })
  it("похожий на номер chatId остаётся собой, а не ключом телефона", () => {
    assert.equal(normalizeChatId("max", "79991234567"), "79991234567")
  })
  it("буквы в идентификаторе не теряются", () => {
    // phoneMatchKey выбрасывал всё нецифровое: «chat-1234567890» → «1234567890».
    assert.equal(normalizeChatId("max", "chat-1234567890"), "chat-1234567890")
  })
  it("групповой чат: берём chatId, а не префикс маршрута", () => {
    // Раньше ЛЮБАЯ такая ссылка давала ключ «c», и все групповые чаты
    // схлопывались в одну привязку — коллизия системная, а не случайная.
    assert.equal(normalizeChatId("max", "https://web.max.ru/c/1234567890123/987"), "1234567890123")
  })
  it("профиль: префикс u тоже пропускаем", () => {
    assert.equal(normalizeChatId("max", "https://web.max.ru/u/12345"), "12345")
  })
  it("две разные группы дают РАЗНЫЕ ключи", () => {
    assert.notEqual(
      normalizeChatId("max", "web.max.ru/c/111/1"),
      normalizeChatId("max", "web.max.ru/c/222/1"),
    )
  })
  it("состояние интерфейса — не чат", () => {
    assert.equal(normalizeChatId("max", "https://web.max.ru/:chat-list"), null)
    assert.equal(normalizeChatId("max", "web.max.ru/:settings/profile"), null)
  })
  it("query отрезаем", () => {
    assert.equal(normalizeChatId("max", "web.max.ru/123456789?from=push"), "123456789")
  })
  it("регистр не значим", () => {
    assert.equal(normalizeChatId("max", "SomeId"), "someid")
  })
  it("список чатов — это НЕ чат", () => {
    // Живая проверка 31.08.2026: когда диалог не выбран, адрес просто
    // «https://web.max.ru/». Отдельного маршрута вида «/:chat-list», как
    // предполагал спайк, не существует.
    assert.equal(normalizeChatId("max", "https://web.max.ru/"), null)
  })
  it("групповой чат: отрицательный id, один сегмент", () => {
    // Живая проверка: группа — это «web.max.ru/-78377804395205», а не
    // «/c/<id>/<messageId>», как предполагал спайк. Знак и есть признак
    // группы — ровно как в Telegram. Значение храним как есть.
    assert.equal(
      normalizeChatId("max", "https://web.max.ru/-78377804395205"),
      "-78377804395205",
    )
  })
  it("личный и групповой чаты не пересекаются по ключу", () => {
    assert.notEqual(
      normalizeChatId("max", "web.max.ru/78377804395205"),
      normalizeChatId("max", "web.max.ru/-78377804395205"),
    )
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
  it("хендл ВК ссылкой матчится с id из адреса открытого диалога", () => {
    // Ради этого «id12345» и приводится к голому числу: администратор вписал в
    // карточку ссылку на страницу, а панель видит в адресе «?sel=777».
    assert.equal(
      normalizeHandle("vk", "https://vk.com/id777"),
      normalizeChatId("vk", "https://vk.com/gim216789012?sel=777"),
    )
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

describe("isMaxGroupChatId — групповые чаты MAX панель не ведёт", () => {
  it("отрицательный id MAX — это группа", () => {
    // Живая проверка: web.max.ru/-78377804395205 — групповой чат.
    assert.equal(isMaxGroupChatId("max", "-78377804395205"), true)
  })
  it("личный чат — не группа", () => {
    assert.equal(isMaxGroupChatId("max", "437719203"), false)
  })
  it("ЗАМОК: на Telegram запрет не распространяется", () => {
    // У Telegram отрицательные id тоже группы, но там они привязываются и
    // работают уже сегодня — распространить проверку значит сломать живой канал.
    assert.equal(isMaxGroupChatId("telegram", "-1001234567890"), false)
  })
  it("пустые значения", () => {
    assert.equal(isMaxGroupChatId("max", null), false)
    assert.equal(isMaxGroupChatId("max", ""), false)
  })
  it("минус посреди строки не считается", () => {
    assert.equal(isMaxGroupChatId("max", "12-34"), false)
  })
})

describe("acceptsPhoneParam — откуда телефону вообще взяться", () => {
  it("WhatsApp: аккаунт и есть номер", () => {
    assert.equal(acceptsPhoneParam("whatsapp"), true)
  })
  it("Telegram: тракт для телефона проложен", () => {
    assert.equal(acceptsPhoneParam("telegram"), true)
  })
  it("MAX: номер закрыт настройкой приватности — принимать нечего", () => {
    // Второй путь к мине Шага 0: панель шлёт chat.phone насквозь, и если туда
    // попадёт идентификатор чата, сервер снова пойдёт искать клиента ПО НОМЕРУ.
    assert.equal(acceptsPhoneParam("max"), false)
  })
  it("VK: телефона нет вовсе", () => {
    assert.equal(acceptsPhoneParam("vk"), false)
  })
})
