/**
 * Сообщение ВКонтакте: направление, время и ключ дедупа.
 *
 * ВСЁ ЗДЕСЬ — ПО ЖИВОЙ РАЗМЕТКЕ, снятой probe 01.09.2026 в сообщениях
 * сообщества (docs/messenger-extension.md §8, Шаг 1). Структура строки:
 *
 *   article.ConvoHistory__messageBlock          ← строка ленты
 *     div.ConvoMessageWithoutBubble
 *       a.ConvoMessageWithoutBubble__avatar     ← автор; есть НЕ у всех
 *         figure.MEAvatar … clip-path: url(#mePeerFrameOffline36Mask-137130907)
 *       span.MessageText                        ← текст
 *       div.ConvoMessageInfoWithoutBubbles
 *         span.…__statusIcon                    ← галочки; только у СВОИХ
 *         span.…__date                          ← часы, «12:24»
 *
 * Функции чистые, DOM не трогают: адаптер вытаскивает строки, а решения
 * принимаются здесь и под тестами (src/__tests__/vk-message.test.js).
 *
 * ── НАПРАВЛЕНИЕ ────────────────────────────────────────────────────────────
 * Классов направления у ВК НЕТ ВООБСЕ — ни `--out`, ни `--in`. Это подтверждено
 * прогоном: единственное, что похоже, — `--withoutBubbles`, где «out» просто
 * часть слова «without». Поэтому направление выводится из трёх признаков, в
 * порядке надёжности:
 *
 *   1. PEER ID АВТОРА из маски аватара. ВК подставляет его в id обрезки:
 *      `mePeerFrameOffline36Mask-137130907`. Знак и есть ответ: минус —
 *      сообщество, то есть МЫ (в сообщениях сообщества наша сторона — само
 *      сообщество, а не человек). Признак машинный и однозначный.
 *   2. ГАЛОЧКИ ПРОЧТЕНИЯ (`__statusIcon`). ВК показывает статус доставки только
 *      у своих сообщений — у чужих его не бывает.
 *   3. НАСЛЕДОВАНИЕ от предыдущей строки. У сообщений подряд одного автора ВК
 *      прячет и аватар, и подпись (`--withoutAuthor`), ровно как WhatsApp
 *      рисует «хвостик» лишь у первого в серии. Тогда направление берётся у
 *      строки выше.
 *
 * ── КЛЮЧ ДЕДУПА ───────────────────────────────────────────────────────────
 * Кандидат в настоящий идентификатор есть — `data-itemkey` на обёртке
 * `VirtualScrollItem` (числа 118, 119, 120…). Но ЕЩЁ НЕ ПОДТВЕРЖДЕНО, что это
 * идентификатор сообщения, а не позиция в виртуальном списке (пункт 73а
 * TESTING.md: прокрутить историю вверх и посмотреть, сдвинулись ли номера).
 *
 * Пока не подтверждено — ключ СИНТЕТИЧЕСКИЙ, как в MAX. Так безопаснее
 * несимметрично: если это индекс, то после подгрузки истории номера съедут, и
 * та же переписка ляжет в карточку ВТОРОЙ раз — необратимо, уникальный ключ не
 * даст её оттуда убрать. Синтетический ключ в худшем случае даёт два известных
 * дефекта (правка сообщения — дубль, два одинаковых сообщения в минуту —
 * схлопывание), и оба обратимы.
 *
 * Как только 73а ответит «номера не сдвинулись» — переключаем ключ на itemkey и
 * ПОДНИМАЕМ ВЕРСИЮ до «v2»: старые синтетические ключи останутся жить рядом, а
 * разовая чистка будет возможна одним запросом.
 */

/**
 * Версия схемы ключа. Обязательна: ключ синтетический, и любое изменение правил
 * сборки породит вторую строку на то же сообщение. Версия делает разовую чистку
 * возможной ОДНИМ запросом — `external_id LIKE '%:v1-%'`.
 */
export const VK_KEY_VERSION = "v1"

// ─────────────────────────────────────────────────────────────────────────────
//  Направление
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Что вычистить из строки ПЕРЕД чтением текста и признаков направления.
 *
 * Реакции здесь несущие, а не косметика. Прогон 01.09.2026 показал у сообщения
 * с «сердечком» класс `ReactionChip--incoming` — и это ЛОЖНЫЙ признак стороны:
 * «incoming» тут про того, кто поставил реакцию, а не про автора сообщения.
 * Наше исходящее, на которое родитель поставил сердце, было бы объявлено
 * входящим — то есть переписка администратора в карточке выглядела бы репликой
 * клиента. Поэтому реакции срезаются до всякого разбора.
 *
 * Меню действий и статус доставки — по той же причине: там свои классы и свой
 * текст, и в реплику родителя им попадать нечего.
 */
export const VK_JUNK_SELECTORS = [
  "[class*='__reactions']",
  "[class*='ReactionChip']",
  "[class*='ConvoMessage__actions']",
  "[class*='MessageActionsDropdown']",
  "[class*='selectToggler']",
  "[class*='navigationSelectToggler']",
]

/** `url(#mePeerFrameOffline36Mask-137130907)` → `-137130907`. */
const AVATAR_MASK_PEER = /Mask(-?\d+)/

/**
 * Peer id автора строки из маски аватара.
 *
 * @param {string|null|undefined} clipPath Значение `clip-path` либо id обрезки.
 * @returns {string|null} Peer id строкой (со знаком), null — не разобрали.
 */
export function parseAuthorPeerId(clipPath) {
  const match = AVATAR_MASK_PEER.exec(String(clipPath ?? ""))
  return match ? match[1] : null
}

/**
 * Кто написал строку.
 *
 * ГЛАВНОЕ ПРАВИЛО — СРАВНЕНИЕ С СОБЕСЕДНИКОМ, а не знак peer id. Автор, чей id
 * совпал с ключом чата, — это собеседник, всё остальное написали мы.
 *
 * Знак сначала казался достаточным: в сообщениях сообщества «наша» сторона —
 * само сообщество, у него id отрицательный. Но в ЛИЧНЫХ сообщениях нашей
 * стороной выступает аккаунт сотрудника, и его id такой же положительный, как у
 * родителя, — по знаку вся исходящая переписка личного чата стала бы входящей.
 * Сравнение с ключом чата верно в обоих случаях сразу.
 *
 * @param {object} input
 * @param {string|null|undefined} [input.authorPeerId] Peer id автора строки.
 * @param {string|null|undefined} [input.chatPeerId] Ключ чата — peer id
 *   СОБЕСЕДНИКА (из адреса). Без него остаётся только знак, и это запасной путь.
 * @param {boolean} [input.hasReadStatus] Есть ли галочки статуса доставки.
 * @param {"incoming"|"outgoing"|null} [input.previousDirection] Направление
 *   предыдущей строки — для сообщений подряд, где ВК прячет автора.
 * @returns {"incoming"|"outgoing"|null} null — признаков не нашлось вовсе;
 *   такую строку заливать НЕЛЬЗЯ: неизвестное направление хуже пропуска.
 */
export function decideDirection(input) {
  const peerId = String(input?.authorPeerId ?? "").trim()
  const chatPeerId = String(input?.chatPeerId ?? "").trim()

  if (peerId && chatPeerId) return peerId === chatPeerId ? "incoming" : "outgoing"

  // Ключа чата нет (сюда обычно не попадаем): судим по знаку. Верно для
  // сообщений сообщества, где наша сторона — оно само.
  if (peerId) return peerId.startsWith("-") ? "outgoing" : "incoming"

  // Галочки прочтения ВК рисует только у СВОИХ сообщений.
  if (input?.hasReadStatus) return "outgoing"
  // Серия сообщений подряд: автор скрыт, направление то же, что у строки выше.
  if (input?.previousDirection === "incoming" || input?.previousDirection === "outgoing") {
    return input.previousDirection
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  Время
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Месяц — сверкой ЦЕЛИКОМ, по списку допустимых форм.
 *
 * В max-time.js и telegram-time.js месяц опознаётся по первым трём буквам, и
 * там это осознанный размен: источник — подсказка браузера, формы которой мы не
 * контролируем. Здесь правило строже, и вот почему: «первые три буквы» делают
 * месяцем любое слово с нужным началом. Тест поймал на «25 мартобря 2025» —
 * разбор уверенно возвращал март. В ленте это была бы ВЫДУМАННАЯ дата, а
 * выдуманная дата хуже отсутствующей: сообщение встанет в чужой день, и понять
 * это по карточке будет нельзя.
 *
 * Карта всё равно своя, а не общая с другими каналами: источники независимы, и
 * смена формата в одном мессенджере не должна ломать разбор в другом.
 * @type {Record<string, number>}
 */
const MONTHS = {
  январь: 0, января: 0, янв: 0,
  февраль: 1, февраля: 1, фев: 1,
  март: 2, марта: 2, мар: 2,
  апрель: 3, апреля: 3, апр: 3,
  май: 4, мая: 4,
  июнь: 5, июня: 5, июн: 5,
  июль: 6, июля: 6, июл: 6,
  август: 7, августа: 7, авг: 7,
  сентябрь: 8, сентября: 8, сен: 8, сент: 8,
  октябрь: 9, октября: 9, окт: 9,
  ноябрь: 10, ноября: 10, ноя: 10, нояб: 10,
  декабрь: 11, декабря: 11, дек: 11,
}

/** «25 апреля 2025» и «16 января» (без года — значит текущий). */
const SEPARATOR_DATE = /^\s*(\d{1,2})\s+([А-Яа-яЁё]{3,})(?:\s+(\d{4}))?\s*$/
/** Часы из `__date`: «12:24». */
const CLOCK = /(\d{1,2}):(\d{2})/

/**
 * Подпись разделителя дня → календарная дата.
 *
 * У ВК она машиночитаемее, чем у прочих каналов: `span.DateSeparator` несёт
 * `aria-label` с ПОЛНОЙ датой и годом — угадывать год, как в Telegram, не надо.
 * «Сегодня» и «Вчера» ВК тоже пишет, поэтому обрабатываем и их.
 *
 * @param {string|null|undefined} text Подпись разделителя.
 * @param {Date} now Точка отсчёта для «Сегодня»/«Вчера». Передаётся явно, чтобы
 *   функция оставалась чистой и проверяемой.
 * @returns {{year: number, month: number, day: number}|null}
 */
export function parseSeparatorDate(text, now) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!value || !(now instanceof Date) || Number.isNaN(now.getTime())) return null

  const lower = value.toLowerCase()
  if (lower === "сегодня") {
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
  }
  if (lower === "вчера") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
  }

  const match = SEPARATOR_DATE.exec(value)
  if (!match) return null
  const day = Number(match[1])
  // Точка в конце сокращения («25 апр. 2025») допустима, «мартобрь» — нет.
  const month = MONTHS[match[2].toLowerCase().replace(/\.$/, "")] ?? -1
  const year = match[3] ? Number(match[3]) : now.getFullYear()
  if (month < 0 || month > 11 || day < 1 || day > 31) return null

  // Отсеиваем «31 февраля»: JS такую дату молча переносит на март.
  const probe = new Date(year, month, day)
  if (probe.getMonth() !== month || probe.getDate() !== day) return null
  return { year, month, day }
}

/**
 * Часы строки → {часы, минуты}.
 * @param {string|null|undefined} text
 * @returns {{hours: number, minutes: number}|null}
 */
export function parseClock(text) {
  const match = CLOCK.exec(String(text ?? ""))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

/**
 * Дата разделителя + часы строки → ISO-время отправки.
 *
 * Время местное — то же, что видит человек; в ISO уедет правильный сдвиг, и в
 * CRM сообщение ляжет своим временем, а не временем заливки.
 *
 * Обе половины обязательны. Час без даты — это «когда-то в 12:24», такое в
 * ленту коммуникаций ставить нельзя.
 *
 * @param {{separator?: string|null, clock?: string|null, now: Date}} input
 * @returns {string|null}
 */
export function buildMessageSentAt(input) {
  const date = parseSeparatorDate(input?.separator, input?.now)
  const clock = parseClock(input?.clock)
  if (!date || !clock) return null
  const stamp = new Date(date.year, date.month, date.day, clock.hours, clock.minutes, 0, 0)
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ключ дедупликации
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Нормализация текста ДЛЯ КЛЮЧА (не для хранения). Разметка перерисовывается, и
 * один и тот же текст между двумя чтениями приходит с разными пробелами; ключ
 * обязан это переживать. В CRM при этом уезжает ОРИГИНАЛЬНЫЙ текст.
 *
 * @param {string|null|undefined} text
 */
function normalizeForKey(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim()
}

/**
 * FNV-1a, 32 бита. Своя реализация: синхронного хеша в браузере нет
 * (SubtleCrypto асинхронный), а ключ нужен внутри разбора DOM.
 *
 * @param {string} value
 * @param {number} seed
 */
function hash32(value, seed) {
  let h = seed >>> 0
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * Два независимых хеша + длина. 32 бита дали бы коллизию примерно на 77 тысячах
 * сообщений, а коллизия здесь означает ПОТЕРЮ сообщения: сервер сочтёт его
 * дублем и не запишет.
 *
 * @param {string[]} parts Склеиваем через « »: нулевого байта в тексте
 *   сообщения быть не может, поэтому границу полей не подделать.
 */
function digest(parts) {
  const payload = parts.join(" ")
  const a = hash32(payload, 2166136261)
  const b = hash32(payload, 0x9e3779b9)
  return (
    a.toString(16).padStart(8, "0") +
    b.toString(16).padStart(8, "0") +
    payload.length.toString(36)
  )
}

/**
 * Ключ сообщения ВК для дедупликации в CRM.
 *
 * Сервер склеит его с каноническим chatId («<chatId>:<ключ>»,
 * buildMessageExternalId), но chatId входит и сюда — чтобы ключ не зависел от
 * серверного правила склейки.
 *
 * БЕЗ ВРЕМЕНИ КЛЮЧА НЕТ, и это гард, а не мелочь: время — единственная часть,
 * которая отличает два одинаковых сообщения в разные дни. Без него ключ стал бы
 * недетерминированным относительно момента чтения, и карточка получала бы копию
 * переписки при каждом открытии чата. Потеря сообщения обратима (зальётся,
 * когда время разберётся), дубль — нет.
 *
 * @param {object} input
 * @param {string} input.chatId Идентификатор чата из адреса.
 * @param {"incoming"|"outgoing"} input.direction
 * @param {string|null|undefined} input.sentAt ISO-время.
 * @param {string|null|undefined} input.text Текст сообщения.
 * @returns {string|null} null — данных не хватает, заливать нельзя.
 */
export function buildVkMessageId(input) {
  const chatId = String(input?.chatId ?? "").trim()
  const direction = input?.direction === "outgoing" ? "outgoing" : "incoming"
  const sentAt = String(input?.sentAt ?? "").trim()
  const text = normalizeForKey(input?.text)
  if (!chatId || !sentAt || !text) return null
  return `${VK_KEY_VERSION}-${digest([chatId, direction, sentAt, text])}`
}

/**
 * Отпечаток «самого свежего сообщения» — по нему адаптер понимает, что в чате
 * что-то появилось, и будит панель.
 *
 * От ключа отличается тем, что время НЕ обязательно: сигнал активности ничего
 * не записывает, а молчать из-за неразобранного разделителя было бы обидно.
 *
 * @param {object} input
 * @param {"incoming"|"outgoing"|null} [input.direction]
 * @param {string|null|undefined} [input.clock]
 * @param {string|null|undefined} input.text
 * @returns {string|null}
 */
export function buildVkActivityKey(input) {
  const text = normalizeForKey(input?.text)
  const clock = normalizeForKey(input?.clock)
  if (!text && !clock) return null
  const direction = input?.direction === "outgoing" ? "outgoing" : "incoming"
  return digest([direction, clock, text])
}
