/**
 * Канонический идентификатор собеседника Telegram (docs/messenger-extension.md §8).
 *
 * ЗАЧЕМ. Telegram Web — два клиента на одном хосте, и один и тот же человек
 * получает в них РАЗНЫЕ идентификаторы: WebK (/k) пишет в хэш «@username», если
 * ник есть, и число, если ника нет; WebA (/a) пишет число всегда. Из-за этого
 * привязка чата, сделанная в /k, в /a не находилась, а переписка, залитая из
 * обоих клиентов, задваивалась в карточке — ключ дедупа сообщения склеивается с
 * идентификатором чата.
 *
 * РЕШЕНИЕ. У ЛИЧНОГО чата числовой peer id в обоих клиентах одинаков и равен
 * telegram user id (проверено по исходникам: tweb getPeerId отдаёт user_id как
 * есть, telegram-tt buildApiPeerId(id, "user") — тоже). Его и берём каноном.
 * В /k он лежит в ВИДИМОМ DOM — в атрибутах data-peer-id, которые клиент
 * проставляет сам. Поэтому ни localStorage/IndexedDB, ни MAIN-world не нужны:
 * обещание §7 («только адресная строка и видимый DOM») остаётся в силе.
 *
 * ГРАНИЦА. Канонизируем ТОЛЬКО положительные числа. У групп, супергрупп и
 * каналов арифметика клиентов расходится: WebK даёт «-<rawId>», WebA —
 * «-(10^12 + rawId)», а отличить базовую группу от супергруппы по одному числу
 * НЕЛЬЗЯ (у Telegram это независимые последовательности id). Соблазн «дописать
 * 10^12» — прямой путь положить переписку одного чата в карточку другого.
 * Групповые чаты остаются как есть; для CRM это не сценарий — переписка с
 * родителем идёт один на один.
 *
 * Здесь только ЧИСТЫЕ функции без обращения к DOM: решение «принять число или
 * отказаться» намеренно вынесено под тесты (src/__tests__/telegram-peer.test.js).
 * Цена ошибки необратима — чужая переписка в карточке клиента, а ключ дедупа не
 * даёт её переписать.
 */

/** «Пира нет» у tweb (NULL_PEER_ID) — это не идентификатор. */
const NULL_PEER_ID = "0"

/**
 * Источники, которым разрешено быть опорой канона.
 *
 * Только они несут ПИРА ДИАЛОГА без подмены: composer — input.ts проставляет
 * чистый chat.peerId; bubble — bubbles.ts кладёт message.peerId, а это тоже пир
 * диалога, а не отправитель. Остальные (аватар, заголовок, элемент списка) идут
 * подтверждением: они живут в шапке и в сайдбаре, где легко поймать соседний чат.
 */
const STRONG_SOURCES = ["composer", "bubble"]

/**
 * @param {string} reason
 * @returns {{peerId: null, source: null, reason: string, needsConfirmation: boolean}}
 */
function refuse(reason) {
  return { peerId: null, source: null, reason, needsConfirmation: false }
}

/**
 * Решить, можно ли считать увиденное в DOM число каноном открытого чата.
 *
 * Отказ — штатный исход, а не ошибка: расширение просто продолжает работать как
 * раньше, ключом остаётся значение из хэша. Поэтому правило намеренно строгое.
 *
 * @param {{
 *   hashId?: string|null,
 *   sources?: Array<{source: string, value: string|null|undefined}>,
 *   previousPeerId?: string|null,
 *   chatSwitched?: boolean,
 * }} [input]
 * @returns {{peerId: string|null, source: string|null, reason: string,
 *   needsConfirmation: boolean}} needsConfirmation — число взято ТОЛЬКО из
 *   разметки, адресная строка его не подтверждает. Такое значение вызывающий
 *   обязан подтвердить вторым наблюдением (см. telegram.js): на кадре
 *   перехода между диалогами в разметке ещё живёт пир прошлого чата.
 */
export function pickPeerId(input = {}) {
  const { hashId = null, sources = [], previousPeerId = null, chatSwitched = false } = input

  /** @type {Array<{source: string, value: string}>} */
  const seen = []
  for (const item of sources) {
    const value = typeof item?.value === "string" ? item.value.trim() : ""
    if (!value || value === NULL_PEER_ID) continue
    if (!/^-?\d+$/.test(value)) continue
    seen.push({ source: String(item?.source || "?"), value })
  }
  if (seen.length === 0) return refuse("в разметке нет числового peer id")

  // Хоть одно отрицательное — это группа/канал либо разметка отдала соседний
  // чат. И то и другое канонизировать нельзя (см. ГРАНИЦА в шапке файла).
  if (seen.some((item) => item.value.startsWith("-"))) {
    return refuse("групповой чат или несогласованная разметка — канон не строим")
  }

  const hashIsNumeric = typeof hashId === "string" && /^-?\d+$/.test(hashId)
  if (hashIsNumeric) {
    // Число уже есть в адресной строке — DOM нужен лишь как подтверждение.
    const agreeing = seen.filter((item) => item.value === hashId)
    if (agreeing.length === 0) {
      return refuse("DOM не подтверждает число из адресной строки")
    }
    return {
      peerId: hashId,
      source: agreeing.map((item) => item.source).join("+"),
      reason: "хэш подтверждён разметкой",
      // Адресная строка — независимый от разметки источник, второе
      // наблюдение здесь ничего не добавит.
      needsConfirmation: false,
    }
  }

  // В хэше «@username» (или его нет вовсе): число берём только из DOM, поэтому
  // требуем согласия ДВУХ источников, один из которых опорный. Одиночное
  // значение слишком легко поймать на кадре перерисовки.
  /** @type {Map<string, string[]>} */
  const byValue = new Map()
  for (const item of seen) {
    const list = byValue.get(item.value) ?? []
    if (!list.includes(item.source)) list.push(item.source)
    byValue.set(item.value, list)
  }
  const good = [...byValue.entries()].filter(
    ([, srcs]) => srcs.length >= 2 && srcs.some((src) => STRONG_SOURCES.includes(src)),
  )
  if (good.length === 0) return refuse("нет двух согласных источников с опорным")
  if (good.length > 1) return refuse("источники разошлись — какой чат открыт, неясно")

  const [value, srcs] = good[0]
  // Кадр перехода: tweb переиспользует Chat-инстанс, и старый data-peer-id живёт
  // в разметке до finishPeerChange. Приняв его сразу после смены чата, мы залили
  // бы переписку нового диалога в карточку прежнего собеседника.
  if (chatSwitched && previousPeerId && value === previousPeerId) {
    return refuse("кадр перехода: в разметке ещё peer id прошлого чата")
  }
  return { peerId: value, source: srcs.join("+"), reason: "согласие источников", needsConfirmation: true }
}

/**
 * Все идентификаторы, под которыми сервер может знать этот чат.
 *
 * Порядок стабилен: сначала то, что видно в адресной строке, потом канон. Какой
 * из них канонический, решает СЕРВЕР (правило разное по каналам) — расширение
 * лишь честно перечисляет увиденное в ОДИН момент в ОДНОМ открытом диалоге.
 *
 * @param {{hashId?: string|null, peerId?: string|null}} [input]
 * @returns {string[]}
 */
export function buildAltIds(input = {}) {
  /** @type {string[]} */
  const out = []
  for (const value of [input.hashId, input.peerId]) {
    const id = typeof value === "string" ? value.trim() : ""
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Сообщение, которое ЕЩЁ НЕ ОТПРАВЛЕНО (у Telegram временный локальный id).
 *
 * Заливать такие нельзя: сервер запомнит сообщение под временным ключом, а через
 * секунду то же самое приедет с настоящим id и ляжет в карточку второй строкой.
 *
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function isLocalMessageId(raw) {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!value) return false
  // WebK: дробный mid вида «222237.0001».
  return /^\d+\.\d+$/.test(value)
}

/**
 * Id сообщения WebK из data-mid.
 * @param {string|null|undefined} dataMid
 * @returns {string|null}
 */
export function parseWebKMessageId(dataMid) {
  const value = typeof dataMid === "string" ? dataMid.trim() : ""
  if (!value) return null
  if (isLocalMessageId(value)) return null
  return /^\d+$/.test(value) ? value : null
}

/**
 * Id сообщения WebA.
 *
 * Приоритет у data-message-id: telegram-tt кладёт туда сырое значение. html-id —
 * фоллбэк, и он неоднозначен: «message-1234-1» это часть альбома (сообщение всё
 * то же, 1234), а «message-1234-000001» — ЛОКАЛЬНОЕ, ещё не отправленное.
 * Ведущий ноль во втором сегменте и есть признак локального.
 *
 * @param {{dataMessageId?: string|null, htmlId?: string|null}} [input]
 * @returns {string|null}
 */
export function parseWebAMessageId(input = {}) {
  const direct = typeof input.dataMessageId === "string" ? input.dataMessageId.trim() : ""
  if (direct) return /^\d+$/.test(direct) ? direct : null

  const htmlId = typeof input.htmlId === "string" ? input.htmlId.trim() : ""
  if (!htmlId.startsWith("message-")) return null
  const parts = htmlId.slice("message-".length).split("-")
  const first = parts[0]
  if (!first || !/^\d+$/.test(first)) return null
  const second = parts[1]
  if (second && /^0\d+$/.test(second)) return null
  return first
}
