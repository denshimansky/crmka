/**
 * Время сообщения WhatsApp: разбор атрибута `data-pre-plain-text`.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Машинного времени в разметке WhatsApp Web нет вовсе.
 * Единственное место, где есть ДАТА, — атрибут `data-pre-plain-text` на элементе
 * с классом `copyable-text`; в бандле он собирается как
 * `"[" + время + "] " + имя + ": "`, а время форматируется через `Intl` в локали
 * интерфейса. То есть строка выглядит так:
 *
 *     [16:04, 12.08.2026] Мама Пети:
 *     [4:04 PM, 8/12/2026] Maria:
 *
 * ГЛАВНАЯ ЛОВУШКА — ПОРЯДОК ДАТЫ. Публичные скраперы разбирают это регуляркой
 * `(\d+)\/(\d+)\/(\d{4})` и молча считают, что первым идёт месяц. На русском
 * интерфейсе первым идёт ДЕНЬ, и «12.08.2026» превратилось бы в 8 декабря.
 * Ошибка тихая: сообщение уедет в карточку с датой из другого месяца, и
 * заметят это через недели.
 *
 * РЕШЕНИЕ. Не гадать, а спросить у того же механизма, которым WhatsApp
 * форматировал: `Intl.DateTimeFormat(локаль).formatToParts()` на заведомо
 * известной дате показывает, в каком порядке эта локаль пишет день, месяц и
 * год. Разбираем строго в этом порядке; эвристика «число больше 12 — это день»
 * оставлена только как последний рубеж.
 *
 * ЧТО ДЕЛАЕМ, ЕСЛИ НЕ РАЗОБРАЛИ. Возвращаем null — и сообщение всё равно
 * заливается, но без времени: сервер поставит время заливки (дефолт колонки).
 * Это отличие от MAX, и оно принципиальное: там время входило в КЛЮЧ дедупа, и
 * сообщение без времени пришлось бы отбрасывать целиком. Здесь ключ —
 * настоящий id сообщения, время на него не влияет, и терять сообщение не за что.
 *
 * Чистые функции, без DOM — покрыты тестами (src/__tests__/wa-time.test.js).
 */

/**
 * Порядок частей даты в локали.
 *
 * Спрашиваем Intl на дате, где день и месяц заведомо различимы (2 марта), и
 * смотрим, в каком порядке он их расставил. Ровно тем же Intl пользуется сам
 * WhatsApp, поэтому ответ по определению совпадает с тем, что на экране.
 *
 * @param {string} [locale] Язык интерфейса; по умолчанию — язык страницы.
 * @returns {Array<"day"|"month"|"year">}
 */
export function dateOrderForLocale(locale) {
  try {
    const parts = new Intl.DateTimeFormat(locale || undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date(Date.UTC(2026, 2, 2)))
    const order = parts
      .map((p) => p.type)
      .filter((t) => t === "day" || t === "month" || t === "year")
    if (order.length === 3) return /** @type {Array<"day"|"month"|"year">} */ (order)
  } catch {
    // Битая локаль — падать нельзя, ниже общий запасной порядок.
  }
  // День-месяц-год: он у большинства локалей, включая русскую.
  return ["day", "month", "year"]
}

/**
 * Разобранная подпись пузыря.
 * @typedef {object} PrePlainText
 * @property {string} time Время как в интерфейсе («16:04», «4:04 PM»).
 * @property {string} date Дата как в интерфейсе («12.08.2026», «8/12/2026»).
 * @property {string|null} author Имя отправителя либо его номер, если контакт не сохранён.
 */

/**
 * Разобрать `data-pre-plain-text` на части.
 *
 * Формат: `[<время>, <дата>] <автор>: `. Автора берём как есть — по нему в
 * группах видно, кто написал, а у НЕсохранённого контакта там стоит
 * международный номер, и это единственный способ узнать телефон собеседника,
 * когда чат уже мигрировал на LID.
 *
 * @param {string|null|undefined} raw
 * @returns {PrePlainText|null}
 */
export function parsePrePlainText(raw) {
  const value = String(raw ?? "").trim()
  if (!value.startsWith("[")) return null
  const close = value.indexOf("]")
  if (close < 0) return null

  const inside = value.slice(1, close)
  // Запятая разделяет время и дату. Ищем ПОСЛЕДНЮЮ: в 12-часовых локалях
  // внутри времени запятых нет, а вот в дате они встречаются.
  const comma = inside.lastIndexOf(",")
  if (comma < 0) return null

  const time = inside.slice(0, comma).trim()
  const date = inside.slice(comma + 1).trim()
  if (!time || !date) return null

  // Хвост после «]»: « Имя: ». Двоеточие в конце ставит сам WhatsApp.
  const tail = value.slice(close + 1).trim()
  const author = tail.endsWith(":") ? tail.slice(0, -1).trim() : tail

  return { time, date, author: author || null }
}

/**
 * Часы и минуты из строки времени, с учётом 12-часового формата.
 *
 * Про пробел перед AM/PM: современный ICU в Chrome ставит там U+202F (узкий
 * неразрывный пробел), а не обычный. Класс «\s» его ловит — это и есть основная
 * защита; замена ниже сводит U+202F и U+00A0 к обычному пробелу вторым слоем,
 * на случай если разбор когда-нибудь перепишут через сравнение строк, где такой
 * пробел выглядит как обычный, но им не является.
 *
 * @param {string} raw
 * @returns {{hours: number, minutes: number}|null}
 */
function parseClock(raw) {
  const value = String(raw ?? "").trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([APap])\.?[Mm]\.?)?$/u.exec(value.replace(/ | /g, " "))
  if (!m) return null

  let hours = Number(m[1])
  const minutes = Number(m[2])
  const half = m[3]?.toLowerCase()
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (minutes > 59) return null

  if (half) {
    if (hours < 1 || hours > 12) return null
    if (half === "a") hours = hours === 12 ? 0 : hours
    else hours = hours === 12 ? 12 : hours + 12
  } else if (hours > 23) {
    return null
  }

  return { hours, minutes }
}

/**
 * Разобрать дату по порядку частей, принятому в локали.
 *
 * @param {string} raw
 * @param {Array<"day"|"month"|"year">} order
 * @returns {{year: number, month: number, day: number}|null}
 */
function parseDate(raw, order) {
  const numbers = String(raw ?? "")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number)
  if (numbers.length < 3) return null

  /** @type {Record<string, number>} */
  const picked = {}
  order.forEach((part, index) => {
    picked[part] = numbers[index]
  })

  let { day, month, year } = /** @type {{day: number, month: number, year: number}} */ (picked)

  // Последний рубеж: если по порядку локали «месяц» оказался больше 12, а «день»
  // подходит на роль месяца — значит порядок мы угадали неверно (или локаль
  // интерфейса не совпадает с локалью браузера). Меняем местами: это тот
  // случай, когда данные сильнее нашего предположения.
  if (month > 12 && day <= 12) {
    const swap = month
    month = day
    day = swap
  }

  if (year < 100) year += 2000
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (year < 2009) return null // WhatsApp появился в 2009-м — раньше сообщений не бывает

  return { year, month, day }
}

/**
 * ISO-время сообщения из `data-pre-plain-text`.
 *
 * Собираем Date из ЛОКАЛЬНЫХ частей и отдаём toISOString(): в интерфейсе время
 * показано в часовом поясе браузера сотрудника, и перевод в UTC делает именно
 * этот конструктор. Считать разобранное время за UTC было бы ошибкой на
 * величину часового пояса — три часа для Москвы.
 *
 * @param {string|null|undefined} raw Значение атрибута.
 * @param {string} [locale] Язык интерфейса мессенджера.
 * @returns {string|null} ISO-строка либо null, если разобрать не удалось.
 */
export function parseWhatsappSentAt(raw, locale) {
  const parsed = parsePrePlainText(raw)
  if (!parsed) return null

  const clock = parseClock(parsed.time)
  if (!clock) return null

  const date = parseDate(parsed.date, dateOrderForLocale(locale))
  if (!date) return null

  const value = new Date(date.year, date.month - 1, date.day, clock.hours, clock.minutes, 0, 0)
  if (Number.isNaN(value.getTime())) return null
  // Сверка: конструктор Date переполняет «31 февраля» в 3 марта молча, а нам
  // такая дата означала бы, что разбор пошёл не туда.
  if (value.getDate() !== date.day || value.getMonth() !== date.month - 1) return null

  return value.toISOString()
}

/**
 * Телефон собеседника из подписи пузыря — запасной источник, когда чат уже
 * мигрировал на LID и номера в JID нет.
 *
 * У НЕсохранённого контакта WhatsApp пишет в подписи международный номер
 * («+91 77378 87058»). У сохранённого — имя из телефонной книги, и тогда номера
 * здесь нет вовсе; это штатный исход, а не ошибка.
 *
 * Осторожность та же, что и везде в этом канале: строку, которая не выглядит
 * номером целиком, телефоном НЕ считаем. Имя вида «+7 Мама Пети» существовать
 * может, и подставлять по нему клиента нельзя.
 *
 * @param {string|null|undefined} author Значение поля author из parsePrePlainText.
 * @returns {string|null} Цифры номера либо null.
 */
export function phoneFromAuthorLabel(author) {
  const value = String(author ?? "").trim()
  if (!value.startsWith("+")) return null
  // Только плюс, цифры и разделители — никаких букв.
  if (!/^\+[\d\s()  .-]+$/u.test(value)) return null
  const digits = value.replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}
