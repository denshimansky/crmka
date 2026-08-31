/**
 * Время отправки сообщения MAX — сборка из двух половин разметки.
 *
 * У MAX машинного времени нет вовсе: ни `title`, ни `datetime`, ни unix-метки.
 * Проверено живыми прогонами (docs/messenger-extension.md §8, Шаг 1). Есть
 * только то, что видит человек, и оно разнесено по двум местам:
 *
 *   • ЧАСЫ — в `span.meta` внутри пузыря: «16:15»;
 *   • ДАТА — в капсуле-разделителе ВЫШЕ группы сообщений: «2 июля 2026»,
 *     «Сегодня», «Вчера».
 *
 * Собираем их вместе. По сравнению с Telegram здесь даже лучше: там года в
 * подсказке могло не быть, а MAX пишет полную дату с годом — угадывать не надо.
 *
 * Отдельный модуль (а не пара строк в адаптере) ровно потому, что это разбор
 * чужого формата: он покрыт тестами и чинится независимо от DOM-селекторов.
 * Не разобрали — возвращаем null: пусть лучше время проставит сервер, чем в
 * карточку клиента уедет выдуманная дата.
 */

/**
 * Месяц по первым трём буквам — так одинаково ловятся «июля» и «июль».
 *
 * Карта продублирована из common/telegram-time.js сознательно: источники разные
 * (там подсказка браузера на языке интерфейса, здесь капсула MAX), и связывать
 * их общим модулем значило бы, что изменение формата в одном мессенджере может
 * сломать разбор в другом. Цена дубля — четыре строки.
 * @type {Record<string, number>}
 */
const MONTHS = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5,
  июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
}

/** «2 июля 2026» и «2 июля» (без года — значит текущий). */
const CAPSULE_DATE = /^\s*(\d{1,2})\s+([А-Яа-яЁё]{3,})(?:\s+(\d{4}))?\s*$/
/** Часы из `.meta`: «16:15». Берём первое совпадение — рядом могут быть галочки. */
const CLOCK = /(\d{1,2}):(\d{2})/

/**
 * Текст капсулы-разделителя → календарная дата.
 *
 * @param {string|null|undefined} text Текст капсулы: «Сегодня», «Вчера», «2 июля 2026».
 * @param {Date} now «Сегодня» и «Вчера» считаются относительно этого момента.
 *   Передаётся явно, чтобы функция оставалась чистой и проверяемой.
 * @returns {{year: number, month: number, day: number}|null}
 */
export function parseCapsuleDate(text, now) {
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

  const match = CAPSULE_DATE.exec(value)
  if (!match) return null
  const day = Number(match[1])
  const month = MONTHS[match[2].toLowerCase().slice(0, 3)] ?? -1
  // Года в капсуле может не быть у дат текущего года — берём год «сейчас».
  const year = match[3] ? Number(match[3]) : now.getFullYear()
  if (month < 0 || month > 11 || day < 1 || day > 31) return null

  // Отсеиваем «31 февраля»: JS такую дату молча переносит на март.
  const probe = new Date(year, month, day)
  if (probe.getMonth() !== month || probe.getDate() !== day) return null
  return { year, month, day }
}

/**
 * Часы из `.meta` → {часы, минуты}.
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
 * Дата капсулы + часы пузыря → ISO-строка времени отправки.
 *
 * Время местное — то же, что видит человек, поэтому и собираем Date в местной
 * зоне: в ISO уедет правильный сдвиг, и в CRM сообщение ляжет своим временем,
 * а не временем заливки.
 *
 * @param {{capsule?: string|null, clock?: string|null, now: Date}} input
 * @returns {string|null} null, если не хватило любой из половин.
 */
export function buildMessageSentAt(input) {
  const date = parseCapsuleDate(input?.capsule, input?.now)
  const clock = parseClock(input?.clock)
  // Обе половины обязательны. Час без даты — это «когда-то в 16:15», такое в
  // ленту коммуникаций ставить нельзя.
  if (!date || !clock) return null
  const stamp = new Date(date.year, date.month, date.day, clock.hours, clock.minutes, 0, 0)
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString()
}
