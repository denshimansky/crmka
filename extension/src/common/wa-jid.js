/**
 * Идентификаторы WhatsApp: разбор `data-id` строки сообщения и разбор JID.
 *
 * ОТКУДА ПРАВИЛА. Из прод-бандла WhatsApp Web, а не из статей: `data-id` на
 * строке сообщения — это `MsgKey.toString()`, а `MsgKey` собирается как
 * `[fromMe, remote, id]`, к которым при наличии дописываются `self` и
 * `participant`. JID сериализуется как `user[:device]@server`.
 *
 * ЧЕМ ЭТО ЦЕННО ДЛЯ НАС. В отличие от MAX, где идентификатора сообщения в
 * разметке нет вовсе и ключ дедупа приходится синтезировать из времени и текста
 * (со всеми принятыми там дефектами), здесь id НАСТОЯЩИЙ. Значит правка
 * сообщения не даст в карточке вторую строку, а два одинаковых коротких
 * сообщения подряд не схлопнутся в одно.
 *
 * ГЛАВНАЯ ОСТОРОЖНОСТЬ — LID. WhatsApp переводит личные чаты с номера
 * («79001234567@c.us») на скрытый идентификатор («123456789@lid»); в бандле
 * лежит целый пласт этой миграции. За LID номера нет, и матч по телефону на нём
 * невозможен. Поэтому здесь нигде нет правила «оставшиеся цифры — это телефон»:
 * номер отдаётся ТОЛЬКО из JID, который сам себя объявил телефонным. Ровно эта
 * мина уже стоила нам разбирательства в MAX (см. §8 спеки, Шаг 0 Фазы 4).
 *
 * Чистые функции, без DOM — покрыты тестами (src/__tests__/wa-jid.test.js).
 */

/**
 * Серверные части JID и что они означают.
 *
 * `c.us` и `s.whatsapp.net` — одно и то же (второе приходит из протокола, при
 * разборе нормализуется в первое). `lid` и `hosted.lid` — скрытый
 * идентификатор. Остальное — не личная переписка.
 */
const JID_SERVERS = {
  "c.us": "user",
  "s.whatsapp.net": "user",
  lid: "lid",
  "hosted.lid": "lid",
  hosted: "lid",
  "g.us": "group",
  broadcast: "broadcast",
  newsletter: "newsletter",
  bot: "bot",
}

/**
 * Разобранный JID.
 * @typedef {object} ParsedJid
 * @property {string} user Локальная часть БЕЗ суффикса устройства.
 * @property {string|null} device Числовой суффикс через двоеточие, если был.
 * @property {string} server Серверная часть как есть («c.us», «lid», …).
 * @property {"user"|"lid"|"group"|"broadcast"|"newsletter"|"bot"|"unknown"} kind
 */

/**
 * Разобрать JID вида `user[:device]@server`.
 *
 * Суффикс устройства отрезаем обязательно: один и тот же собеседник приходит и
 * как «79001234567@c.us», и как «79001234567:12@c.us» (сообщение с другого
 * устройства). Без отрезания это два разных чата в CRM.
 *
 * @param {string|null|undefined} raw
 * @returns {ParsedJid|null} null — на вход пришёл не JID.
 */
export function parseJid(raw) {
  const value = String(raw ?? "").trim()
  if (!value) return null
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null

  const local = value.slice(0, at)
  const server = value.slice(at + 1).toLowerCase()
  const colon = local.indexOf(":")
  const user = colon >= 0 ? local.slice(0, colon) : local
  const device = colon >= 0 ? local.slice(colon + 1) : null
  if (!user) return null

  return {
    user,
    device: device || null,
    server,
    kind: /** @type {ParsedJid["kind"]} */ (JID_SERVERS[server] ?? "unknown"),
  }
}

/**
 * Личный ли это чат — единственный вид, который панель обслуживает.
 *
 * Группы, рассылки, статусы и каналы НЕ обслуживаются сознательно: за таким
 * чатом стоит не один человек, и его переписка не может лежать в карточке
 * одного клиента. Ошибка тут необратима — уникальный ключ (tenantId, channel,
 * externalId) не даст переписать уже записанное.
 *
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function isPersonalChatJid(raw) {
  const jid = parseJid(raw)
  if (!jid) return false
  if (jid.kind !== "user" && jid.kind !== "lid") return false
  // Служебные аккаунты WhatsApp: «0@c.us» (сервер), «server@c.us»,
  // «16505361212@c.us» (официальный аккаунт WhatsApp). Клиентами они не бывают.
  if (jid.server === "c.us" && (jid.user === "0" || jid.user === "server")) return false
  return true
}

/**
 * Номер телефона из JID — ТОЛЬКО если JID сам себя объявил телефонным.
 *
 * Никакой арифметики «оставим цифры»: за «@lid» стоит не номер, а внутренний
 * идентификатор WhatsApp, и попытка обойтись с ним как с телефоном приводит к
 * поиску клиента по чужому номеру и автоматической подстановке постороннего
 * человека. Сервер это же правило дублирует (нормализация возвращает
 * «lid:<число>» отдельным видом), но адаптер обязан не отправлять телефон там,
 * где его нет.
 *
 * @param {string|null|undefined} raw
 * @returns {string|null} Цифры номера, либо null.
 */
export function phoneFromJid(raw) {
  const jid = parseJid(raw)
  if (!jid || jid.kind !== "user") return null
  if (!/^\d{7,}$/.test(jid.user)) return null
  return jid.user
}

/**
 * Разобранный ключ сообщения.
 * @typedef {object} ParsedMessageKey
 * @property {boolean|null} fromMe Наше ли сообщение. null — формат без направления.
 * @property {string|null} chatJid JID чата (без суффикса устройства). null — формат без чата.
 * @property {string} messageId Идентификатор сообщения — он и идёт в ключ дедупа.
 * @property {string|null} participant JID автора в группе, если был.
 * @property {"key"|"bare"} shape Что именно распозналось: упакованный ключ или голый id.
 */

/**
 * Разобрать значение `data-id` строки сообщения.
 *
 * ФОРМАТ (из бандла): `fromMe _ remote _ id [_ self] [_ participant]`, где
 * `self` — это «in» либо «out» и встречается в чате с самим собой. Отсюда
 * разбор четвёртого сегмента: «in»/«out» → это self, иначе — participant.
 * Слепое правило «четвёртый сегмент = участник» ошибается ровно в «Сообщениях
 * себе».
 *
 * ПОЧЕМУ ПРИНИМАЕМ И ГОЛЫЙ ID. Полевые наблюдения стороннего скрапера (весна
 * 2026) говорят, что `data-id` может приходить одним лишь идентификатором
 * сообщения. Код бандла этого не подтверждает, противоречие снимет живой probe,
 * но поддержать оба вида дёшево — и это же спасёт при будущей смене формата.
 * В таком случае chatId адаптер добирает из разметки, а направление — из
 * классов пузыря.
 *
 * @param {string|null|undefined} raw
 * @returns {ParsedMessageKey|null} null — не разобрали, сообщение пропускаем.
 */
export function parseMessageKey(raw) {
  const value = String(raw ?? "").trim()
  if (!value) return null

  const parts = value.split("_")

  // Голый идентификатор: ни направления, ни чата. Проверяем, что это похоже на
  // id сообщения WhatsApp (hex или буквенно-цифровая строка), а не на обрывок
  // разметки: мусорный ключ дедупа хуже пропущенного сообщения.
  if (parts.length === 1) {
    if (!/^[0-9A-Za-z._=-]{8,}$/.test(value)) return null
    return { fromMe: null, chatJid: null, messageId: value, participant: null, shape: "bare" }
  }

  if (parts.length < 3) return null
  const [flag, remote, id] = parts
  if (flag !== "true" && flag !== "false") return null
  if (!id) return null

  const chat = parseJid(remote)
  if (!chat) return null

  // ЗЕРКАЛИМ ПАРСЕР САМОГО WHATSAPP, а не изобретаем свой.
  //
  // Он берёт первые три сегмента БЕЗУСЛОВНО, а дальше смотрит только на длину:
  // при четырёх сегментах четвёртый — участник, если это не «in»/«out»; при
  // пяти участник — пятый. Лишние сегменты его не смущают вовсе.
  //
  // Почему это важно: заякоренная строгая проверка «ровно 3–5 сегментов»
  // вернула бы null на любом лишнем подчёркивании (например, в идентификаторе
  // сообщения от стороннего клиента), и адаптер выбросил бы сообщение целиком.
  // Совпадать с правилом самого мессенджера тут ценнее, чем быть строже него:
  // расширение формата мы переживём так же, как переживёт его WhatsApp.
  let participant = null
  if (parts.length === 4 && parts[3] !== "in" && parts[3] !== "out") {
    participant = normalizeJid(parts[3])
  } else if (parts.length >= 5) {
    participant = normalizeJid(parts[4])
  }

  return {
    fromMe: flag === "true",
    chatJid: normalizeJid(remote),
    messageId: id,
    participant,
    shape: "key",
  }
}

/**
 * JID в канонической форме: без суффикса устройства, сервер в нижнем регистре,
 * `s.whatsapp.net` сведён к `c.us`.
 *
 * Нормализация нужна на СТОРОНЕ АДАПТЕРА, а не только на сервере: ключ дедупа
 * сообщения склеивается с chatId, и если один и тот же чат приедет то с
 * суффиксом устройства, то без него, вся его переписка задвоится.
 *
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeJid(raw) {
  const jid = parseJid(raw)
  if (!jid) return null
  const server = jid.server === "s.whatsapp.net" ? "c.us" : jid.server
  return `${jid.user.toLowerCase()}@${server}`
}
