import type { CommunicationChannel } from "@prisma/client"
import { phoneMatchKey } from "@/lib/phone"

/**
 * Нормализация идентификаторов чата и мессенджер-хендлов
 * (docs/messenger-extension.md).
 *
 * Зачем: один и тот же собеседник приходит из расширения по-разному —
 * «@masha», «https://t.me/masha», «Masha» — а в карточке клиента поля
 * telegram/vk/max заполняются людьми свободным текстом (ссылка, ник, id).
 * Чтобы привязка чата находилась, обе стороны приводим к одному виду.
 *
 * Здесь только чистые функции без обращения к БД — их можно покрывать
 * юнит-тестами (npm run test:unit).
 */

/**
 * Префикс ключа чата, выданного НАМИ, а не прочитанного из мессенджера.
 *
 * Нужен для WhatsApp: там идентификатора чата в разметке нет вовсе, и диалог
 * опознаётся по идентификаторам своих сообщений (lib/ext/chat-message-refs.ts).
 * Префикс делает происхождение ключа видимым — и в базе, и в коде: без него
 * такой ключ однажды попробовали бы разобрать как телефон или как JID.
 */
export const MINTED_CHAT_KEY_PREFIX = "wa-msg:"

/** Выдан ли этот ключ нами (в отличие от прочитанного из мессенджера). */
export function isMintedChatKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(MINTED_CHAT_KEY_PREFIX)
}

/** Каналы, по которым работает расширение (внутренние/телефон/почта — не они). */
export const MESSENGER_CHANNELS = ["whatsapp", "telegram", "vk", "max"] as const

export type MessengerChannel = (typeof MESSENGER_CHANNELS)[number]

export function isMessengerChannel(value: string): value is MessengerChannel {
  return (MESSENGER_CHANNELS as readonly string[]).includes(value)
}

/**
 * Приводит идентификатор чата к каноническому виду для хранения в
 * ChatBinding.externalChatId и сравнения с полями карточки.
 *
 * Telegram: «@masha», «t.me/masha», «https://web.telegram.org/k/#@masha» → «masha»;
 *           числовой peer id остаётся числом (в WebA хэш всегда числовой).
 * VK:       «vk.com/gim216789012?sel=45678901» → «45678901» (собеседник из sel,
 *           а НЕ сообщество из пути); «vk.com/id12345» → «12345»;
 *           «https://vk.com/durov» → «durov»; беседа → «c<N>», сообщество →
 *           «-<N>» (оба не обслуживаются, см. isUnsupportedChat); «vk.com/im»
 *           без выбранного диалога → null. Разбор — normalizeVkChatId.
 * WhatsApp: «79991234567@c.us», «+7 (999) 123-45-67» → последние 10 цифр
 *           (тот же ключ, что у findClientsByPhone); LID-идентификаторы
 *           («12345@lid») сохраняем как «lid:12345» — номера за ними нет.
 * MAX:      «web.max.ru/1234567890123» → «1234567890123»;
 *           «web.max.ru/c/1234567890123/987» → «1234567890123» (первый значащий
 *           сегмент пути); состояния интерфейса («/:chat-list») → null.
 *           chatId хранится КАК ЕСТЬ: это не телефон (см. normalizeMaxChatId).
 *
 * Возвращает null, если после очистки ничего не осталось.
 */
export function normalizeChatId(channel: MessengerChannel, raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim()
  if (!value) return null

  // Ключ, выданный НАМИ (чат без собственного идентификатора — см.
  // lib/ext/chat-message-refs.ts), возвращаем как есть. Без этой строки он
  // попал бы в телефонную ветку ниже, и «wa-msg:2f1c…» превратилось бы в
  // десятизначное число из цифр uuid — идентификатор, неотличимый от номера
  // телефона. Ровно эта ошибка уже случалась в MAX и подставляла в карточку
  // постороннего человека.
  if (isMintedChatKey(value)) return value

  // Срезаем протокол и известные хосты, оставляя «хвост» — сам идентификатор.
  value = value.replace(/^https?:\/\//i, "")
  value = value.replace(
    /^(?:web\.telegram\.org\/[ka]\/?#?|t\.me\/|telegram\.me\/|m\.vk\.com\/|web\.vk\.me\/|vk\.com\/|vk\.ru\/|vk\.me\/|web\.max\.ru\/|max\.ru\/|web\.whatsapp\.com\/)/i,
    "",
  )
  value = value.replace(/^@+/, "").trim()

  // MAX разбираем ДО общей обрезки: у него путь многосегментный, и обрезка по
  // первому «/» схлопывала бы ВСЕ групповые чаты в один ключ «c».
  if (channel === "max") return normalizeMaxChatId(value)

  // ВК — тоже ДО общей обрезки, и по той же причине, только хуже: собеседник у
  // него лежит не в пути, а в параметре «sel», и обрезка по «?» выбрасывала
  // именно его (см. normalizeVkChatId).
  if (channel === "vk") return normalizeVkChatId(value)

  // Отрезаем query/хвост пути: «durov?w=wall1_1» → «durov».
  value = value.split(/[?#/]/)[0]?.trim() ?? ""
  if (!value) return null

  // Ниже остались только whatsapp и telegram: max и vk разобраны выше своими
  // правилами, и компилятор это знает — ветки для них здесь недостижимы.
  switch (channel) {
    case "whatsapp": {
      // Не личный чат — идентификатора НЕ производим вовсе (см.
      // isUnsupportedChat). Проверка стоит первой сознательно: ниже начинается
      // ветка «считаем оставшиеся цифры телефоном», и групповой JID
      // «120363123456789012@g.us» она превращала в ключ «3456789012» —
      // неотличимый от номера. Дальше resolve-client искал по нему клиента ПО
      // ТЕЛЕФОНУ и при единственном совпадении подставлял его сам. Ровно эта
      // мина была обезврежена для MAX в Шаге 0 Фазы 4 — здесь она же.
      if (isUnsupportedWhatsappJid(value)) return null
      // «<id>@lid» — WhatsApp прячет номер (тренд 2025-2026, LID/username):
      // сохраняем сам LID, матч по телефону тут невозможен.
      const lid = /^(\d+)@lid$/i.exec(value)
      if (lid) return `lid:${lid[1]}`
      const jid = /^(\d+)@(?:c\.us|s\.whatsapp\.net)$/i.exec(value)
      const digitsSource = jid ? jid[1] : value
      return phoneMatchKey(digitsSource) ?? value.toLowerCase()
    }
    case "telegram":
      // Регистр в username не значим: «Durov» и «durov» — один аккаунт.
      return value.toLowerCase()
  }
}

/**
 * Служебные префиксы маршрутов MAX — не часть идентификатора чата.
 * «/c/<chatId>/<messageId>» — сообщение в канале, «/u/<id>» — профиль и т.д.
 */
const MAX_ROUTE_PREFIXES = new Set([
  "c",
  "u",
  "join",
  "joincall",
  "stickerset",
  "_storybook",
])

/**
 * Идентификатор чата MAX — ПЕРВЫЙ ЗНАЧАЩИЙ СЕГМЕНТ ПУТИ, как есть.
 *
 * Здесь было две мины, и обе вели к чужой переписке в карточке клиента.
 *
 * ПЕРВАЯ: chatId прогонялся через phoneMatchKey с комментарием «MAX завязан на
 * номер телефона». Но chatId в MAX — это длинное число, а не номер: phoneMatchKey
 * брал у него последние 10 цифр (старшие разряды терялись молча), а у строки с
 * буквами выбрасывал буквы целиком. Дальше resolve-client искал по этому обрезку
 * КЛИЕНТА ПО ТЕЛЕФОНУ и при единственном совпадении подставлял его без участия
 * человека. Телефон теперь принимается только отдельным явным полем — так же,
 * как это давно сделано для Telegram.
 *
 * ВТОРАЯ: общая обрезка пути по первому «/» превращала «web.max.ru/c/123/987» в
 * «c». Все групповые чаты и каналы схлопывались в ОДИН ключ, а уникальный индекс
 * (tenantId, channel, externalChatId) склеивал их в одну привязку. Эта коллизия
 * опаснее телефонной: она не случайная, а системная.
 *
 * Значение возвращаем в нижнем регистре — как у telegram/vk, регистр не значим.
 */
function normalizeMaxChatId(value: string): string | null {
  // Query и хэш отрезаем, путь разбираем целиком.
  const path = value.split(/[?#]/)[0] ?? ""
  for (const segment of path.split("/")) {
    const part = segment.trim()
    if (!part) continue
    // Псевдо-маршруты состояния интерфейса («:chat-list», «:settings/...») —
    // это не чат, и привязывать их к клиенту нельзя.
    if (part.startsWith(":")) return null
    if (MAX_ROUTE_PREFIXES.has(part.toLowerCase())) continue
    return part.toLowerCase()
  }
  return null
}

/**
 * Первый сегмент пути ВК, за которым СОБЕСЕДНИК НЕ СТОИТ: это сам интерфейс
 * переписки. «im» — личные сообщения, «gim<id сообщества>» — сообщения
 * сообщества (главная поверхность для детских центров), «mail» — старый адрес.
 */
const VK_MESSENGER_ROUTES = /^(?:im|gim\d+|mail)$/i

/**
 * Идентификатор чата ВК: СОБЕСЕДНИК из параметра «sel», а не путь.
 *
 * ЗДЕСЬ БЫЛА МИНА, и она опаснее обеих найденных в MAX. Раньше ВК разбирался
 * общим правилом (срезать хост, отрезать всё после «?» или «/»), и живые адреса
 * превращались в такое:
 *
 *   vk.com/gim216789012?sel=45678901 → «gim216789012»
 *   vk.com/gim216789012?sel=99999999 → «gim216789012»   ← ТОТ ЖЕ КЛЮЧ
 *   vk.com/im?sel=123456             → «im»
 *
 * То есть ВСЕ диалоги сообщества схлопывались в один ключ — id сообщества, —
 * а все личные в «im». Уникальный индекс (tenantId, channel, external_chat_id)
 * склеил бы их в ОДНУ привязку, и переписка всех родителей центра уехала бы в
 * карточку того клиента, которого привязали первым. Необратимо: ключ дедупа
 * не даёт переписать уже записанные строки. В MAX такая же системная коллизия
 * стоила отдельного шага работ (Фаза 4, Шаг 0) — этот её близнец.
 *
 * ЖИВОЙ ПРОГОН 01.09.2026 ОПРОВЕРГ ФОРМУ АДРЕСА, взятую заочно. У сообщества
 * открывается НЕ старый `vk.com/im`, а новый VK Messenger, встроенный в
 * страницу сообщества, и диалог назван в ПУТИ, а не параметром:
 *
 *   vk.ru/gim137130907/convo/335368817?entrypoint=list_all
 *
 * Прежний разбор отдавал на нём null (чат не опознан) — безопасно, но
 * бесполезно. Поэтому сегмент после «convo» теперь и есть собеседник, а разбор
 * «sel» оставлен: старый интерфейс никуда не делся, и в браузерах сотрудников
 * какое-то время живут обе формы. ⚠️ Чем ИМЕННО является число после «convo» —
 * peer id пользователя или внутренний номер диалога — probe пока не ответил
 * (вопрос второго прогона). На безопасность это не влияет: ключ уникален на
 * диалог в обоих случаях. Влияет только на автоподсказку по ссылке из карточки
 * клиента: она сработает, если это peer id.
 *
 * Правила разбора:
 *   • собеседник — сегмент пути после «convo» либо параметр «sel»/«peer»
 *     (query или хэш): это ровно тот, чей диалог открыт, независимо от того,
 *     чьё сообщество стоит в пути;
 *   • «id12345» и «12345» — один и тот же человек, ключ «12345». Это делает
 *     осмысленным поле карточки: администратор вписал ссылку vk.com/id12345 —
 *     панель узнает чат сама, без ручной привязки;
 *   • беседа («c45», либо peer ≥ 2 000 000 000 по кодировке VK API) → «c45»;
 *     сообщество («-216789012», «club216789012», «public…», «event…») →
 *     «-216789012». Обе формы приводятся к одному виду СОЗНАТЕЛЬНО, хотя такие
 *     чаты и не обслуживаются: гард должен ловить их, как бы они ни пришли;
 *   • адрес мессенджера без выбранного диалога («vk.com/im», «vk.com/gim123»)
 *     → null: чат не выбран, привязывать нечего;
 *   • всё прочее — короткое имя страницы («durov»), в нижнем регистре: так
 *     хранят хендл в карточке клиента.
 */
function normalizeVkChatId(value: string): string | null {
  const [pathPart = "", ...rest] = value.split(/[?#]/)
  const segments = pathPart.split("/").filter((part) => part.trim().length > 0)

  // Новый VK Messenger: «…/convo/<собеседник>». Читаем ПЕРВЫМ делом — это
  // подтверждённая живым прогоном форма, а «sel» остался только у старого
  // интерфейса.
  const convoAt = segments.findIndex((part) => part.toLowerCase() === "convo")
  if (convoAt >= 0) {
    const peer = segments[convoAt + 1]?.trim()
    // «convo» без собеседника — открыт список диалогов, а не чат.
    return peer ? normalizeVkPeer(peer) : null
  }

  // Собеседник может приехать и в query, и в хэше — старый ВК жил на хэшах.
  const params = new URLSearchParams(rest.join("&").replace(/^[?#]/, ""))
  const selected = (params.get("sel") ?? params.get("peer") ?? "").trim()

  if (selected) return normalizeVkPeer(selected)

  const segment = segments[0]?.trim() ?? ""
  if (!segment) return null
  // Открыт мессенджер, но диалог не выбран — это НЕ чат.
  if (VK_MESSENGER_ROUTES.test(segment)) return null
  return normalizeVkPeer(segment)
}

/** Один собеседник ВК во всех его написаниях → один ключ. */
function normalizeVkPeer(raw: string): string | null {
  const value = raw.trim().replace(/^@+/, "")
  if (!value) return null

  // Беседа: «c45» в адресе, 2000000000 + id в терминах VK API.
  const chat = /^c(\d+)$/i.exec(value)
  if (chat) return `c${chat[1]}`
  if (/^\d+$/.test(value) && Number(value) >= VK_CHAT_PEER_BASE) {
    return `c${Number(value) - VK_CHAT_PEER_BASE}`
  }

  // Сообщество: минус в peer id, «club/public/event» в адресе страницы.
  const community = /^(?:-|club|public|event)(\d+)$/i.exec(value)
  if (community) return `-${community[1]}`

  // Человек: «id12345» и «12345» — одно и то же.
  const user = /^(?:id)?(\d+)$/i.exec(value)
  if (user) return user[1]

  // Короткое имя страницы. Регистр не значим: «Durov» и «durov» — один аккаунт.
  return value.toLowerCase() || null
}

/** С этого числа начинаются peer id бесед в VK API (2 000 000 000 + id беседы). */
const VK_CHAT_PEER_BASE = 2_000_000_000

/**
 * Чат ВК, за которым стоит НЕ ОДИН человек: беседа («c45») или сообщество
 * («-216789012»).
 *
 * Причина отказа та же, что у групп MAX и WhatsApp: переписку нескольких людей
 * нельзя положить в карточку одного клиента, а ключ дедупа не даст её оттуда
 * убрать. Сообщество попадает сюда же осознанно — за ним стоит команда, а не
 * родитель; в рабочем сценарии (администратор отвечает от имени сообщества
 * центра) собеседник всегда человек, и отрицательный peer означает, что
 * сотрудник переписывается с другой организацией.
 */
export function isVkUnsupportedChatId(chatId: string | null | undefined): boolean {
  const value = (chatId ?? "").trim()
  return /^c\d+$/i.test(value) || /^-\d+$/.test(value)
}

/**
 * Положительное число — ЛИЧНЫЙ чат Telegram (пользователь или бот).
 *
 * Единственный случай, где идентификатор одного и того же собеседника
 * доказанно совпадает в двух клиентах Telegram Web: и WebK, и WebA отдают
 * telegram user id как есть. У групп, супергрупп и каналов (число со знаком
 * минус) арифметика клиентов расходится, и по одному числу отличить базовую
 * группу от супергруппы нельзя — такие чаты канонизировать НЕЛЬЗЯ.
 */
export function isPositiveNumericChatId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d+$/.test(value) && value !== "0"
}

/**
 * Групповой чат MAX: отрицательное число в адресе.
 *
 * Живая проверка 31.08.2026: личный чат — `web.max.ru/437719203`, групповой —
 * `web.max.ru/-78377804395205`. Знак и есть признак, как в Telegram.
 *
 * Панель групповые чаты MAX не обслуживает СОЗНАТЕЛЬНО: привязка группы к
 * клиенту — не рабочий сценарий (администраторы ведут переписку с родителями
 * один на один), а цена ошибки необратима — вся групповая переписка чужих
 * родителей уедет в карточку одного человека, и уникальный ключ не даст её
 * оттуда убрать.
 *
 * СТРОГО по каналу max. У Telegram отрицательные id — тоже группы, но там они
 * привязываются и работают уже сегодня; распространить проверку на telegram
 * значит сломать живой канал.
 */
export function isMaxGroupChatId(
  channel: MessengerChannel,
  chatId: string | null | undefined,
): boolean {
  if (channel !== "max") return false
  return /^-\d+$/.test((chatId ?? "").trim())
}

/**
 * Виды чатов WhatsApp, которые панель не обслуживает.
 *
 * «@g.us» — группа, «@broadcast» — список рассылки (и лента статусов
 * «status@broadcast»), «@newsletter» — канал. Общее у них одно: за таким чатом
 * стоит НЕ ОДИН человек, и вся переписка уехала бы в карточку одного клиента.
 *
 * Проверяем ВХОЖДЕНИЕМ, а не концом строки. Строгий «$» правилен для чистого
 * JID, но сюда значение приходит из браузера сотрудника — из старой сборки
 * расширения, из ручного ввода, из будущего формата, где к JID припишут суффикс.
 * Личный чат подстроку «@g.us» не содержит никогда, так что параноидальная
 * проверка не может дать ложного запрета, а строгая — может дать ложный пропуск.
 */
const WHATSAPP_UNSUPPORTED_JID = /@(?:g\.us|broadcast|newsletter)\b/i

function isUnsupportedWhatsappJid(value: string): boolean {
  return WHATSAPP_UNSUPPORTED_JID.test(value)
}

/**
 * Чат, который панель НЕ ВЕДЁТ, — по СЫРОМУ идентификатору, до нормализации.
 *
 * Почему по сырому. У MAX признак группы (минус) переживает нормализацию, и
 * гарда по канону хватало. У WhatsApp признак — это СУФФИКС JID, а нормализация
 * его уничтожает: к моменту проверки канона «120363…@g.us» уже превратился в
 * десятизначное число, неотличимое от телефона. Значит проверять надо раньше —
 * до splitChatIds, на том, что прислало расширение.
 *
 * Гард обязан быть серверным. В браузере сотрудника какое-то время живёт старая
 * сборка расширения, и клиентские рубежи её не переживают; этот — переживает.
 * Цена пропуска необратима: уникальный ключ (tenantId, channel, externalId) не
 * даст переписать уже записанную чужую переписку.
 *
 * @param channel Канал мессенджера.
 * @param raw Идентификатор, как его прислало расширение (chatId либо любой altId).
 */
export function isUnsupportedChat(
  channel: MessengerChannel,
  raw: string | null | undefined,
): boolean {
  const value = (raw ?? "").trim()
  if (!value) return false
  if (channel === "whatsapp") return isUnsupportedWhatsappJid(value)
  // У MAX признак группы переживает нормализацию — переиспользуем прежнее
  // правило, чтобы у двух каналов был один вход в проверку.
  if (channel === "max") return isMaxGroupChatId("max", normalizeChatId("max", value))
  // У ВК признак тоже переживает нормализацию, но САМ разбор адреса и есть
  // защита: беседа и сообщество приводятся к «c45» / «-216789012» из любой
  // формы записи, какой бы сборкой расширения она ни была прислана.
  if (channel === "vk") return isVkUnsupportedChatId(normalizeChatId("vk", value))
  return false
}

/**
 * Почему панель не ведёт этот чат — текстом для сотрудника.
 *
 * Формулировка важна: молчание человек читает как поломку и идёт жаловаться,
 * а «панель этого не умеет» — как решение. Поэтому объясняем и что именно не
 * поддержано, и почему.
 */
export function unsupportedChatMessage(channel: MessengerChannel): string {
  if (channel === "whatsapp") {
    return "Групповые чаты, рассылки и каналы WhatsApp панель не ведёт: за таким чатом стоит не один человек, и его переписку нельзя положить в карточку одного клиента"
  }
  if (channel === "vk") {
    return "Беседы и диалоги с сообществами ВКонтакте панель не ведёт: за таким чатом стоит не один человек, и его переписку нельзя положить в карточку одного клиента"
  }
  return "Групповые чаты MAX панель не ведёт: переписку группы нельзя положить в карточку одного клиента"
}

/**
 * Можно ли доверять телефону, пришедшему отдельным полем запроса.
 *
 * Шаг 0 закрыл путь «chatId → phoneMatchKey», но остался второй: панель шлёт
 * `chat.phone` насквозь, и если туда попадёт идентификатор чата, сервер снова
 * пойдёт искать клиента ПО НОМЕРУ и подставит чужого без участия человека.
 *
 * Поэтому телефон принимаем только там, где канал в принципе способен его
 * отдать. В MAX номер закрыт настройкой приватности, в VK его нет — значит
 * оттуда телефон приходить не должен вовсе, и принимать его — чистый риск без
 * выгоды. То, что наш адаптер ставит null, — дисциплина, а не гарантия.
 */
export function acceptsPhoneParam(channel: MessengerChannel): boolean {
  return channel === "whatsapp" || channel === "telegram"
}

/**
 * Id ещё не отправленного сообщения (временный, дробный — «222237.0001»).
 *
 * Второй рубеж поверх фильтра в адаптере: в браузерах сотрудников какое-то
 * время живут старые сборки расширения, а такой ключ означает вторую строку в
 * карточке — через секунду то же сообщение приедет с настоящим id.
 */
export function isLocalMessageId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d+\.\d+$/.test(value.trim())
}

/**
 * Нормализует значение поля-хендла из карточки клиента (Client.telegram/vk/max),
 * чтобы сравнивать его с normalizeChatId. Те же правила — отдельная функция
 * нужна лишь как читаемая точка вызова на стороне резолва.
 */
export function normalizeHandle(
  channel: MessengerChannel,
  raw: string | null | undefined,
): string | null {
  return normalizeChatId(channel, raw)
}

/** Поле карточки клиента, где хранится хендл этого канала (у WhatsApp его нет — там телефон). */
export function handleFieldForChannel(channel: MessengerChannel): "telegram" | "vk" | "max" | null {
  switch (channel) {
    case "telegram":
      return "telegram"
    case "vk":
      return "vk"
    case "max":
      return "max"
    case "whatsapp":
      return null
  }
}

/**
 * Стабильный ключ дедупликации сообщения для Communication.externalId.
 * Уникальность в БД — по паре (tenantId, channel, externalId), поэтому канал
 * в ключ не включаем, но чат включаем: id сообщения уникален только внутри чата
 * (так устроен Telegram — mid уникален в пределах пира).
 */
export function buildMessageExternalId(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`
}

/**
 * Время сообщения из мессенджера → Date, а «не смогли разобрать» → undefined,
 * НЕ null.
 *
 * Разница принципиальная: Prisma трактует undefined как «поле не задано» и
 * оставляет дефолт колонки (now(), миграция 20260828150000), а явный null
 * пишет в базу NULL. Адаптеры отдают sentAt: null штатно — Telegram WebA
 * машинного времени в разметке не имеет вовсе, — и с null сюда уезжала
 * переписка без времени: в лентах CRM (сортировка nulls: "last") такие строки
 * падают в самый низ истории, а в панели — наоборот всплывают наверх.
 * Время заливки — плохое приближение, но монотонное и не ломающее порядок.
 *
 * Принимаем ISO-строку и unix-время в секундах (так отдаёт WhatsApp Store) или
 * миллисекундах.
 */
export function parseMessageSentAt(
  value: string | number | null | undefined,
): Date | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Тип коммуникации по направлению — универсальный, канал несёт поле channel. */
export function messageTypeForDirection(direction: "incoming" | "outgoing") {
  return direction === "incoming" ? ("messenger_incoming" as const) : ("messenger_outgoing" as const)
}

/** Канал мессенджера → значение enum Prisma (типобезопасное сужение). */
export function toPrismaChannel(channel: MessengerChannel): CommunicationChannel {
  return channel as CommunicationChannel
}
