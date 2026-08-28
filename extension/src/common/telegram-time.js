/**
 * Время отправки сообщения Telegram Web — разбор подсказки у пузыря.
 *
 * Машинного времени в разметке нет: на пузыре tweb оставляет только `data-mid`
 * (bubbles.ts), а видимое «10:14» лежит внутри блока текста и без чистки
 * склеивается с самим сообщением («дальше10:14»). Единственный источник полной
 * даты — атрибут `title` у `.time-inner`: туда messageRender.ts пишет
 * `getFullDate()`. Формат зависит от языка интерфейса и настроек:
 *
 *   «28 августа 2026, 10:14:31»  — обычный (месяц словом, локаль интерфейса);
 *   «28 August 2026, 10:14:31»   — английский интерфейс;
 *   «28.08.2026, 10:14:31»       — если месяц числом;
 *   у отредактированных и пересланных дальше идут строки «Edited: …» /
 *   «Original: …» — нас интересует только первая, это время отправки.
 *
 * Время в подсказке местное — то же, что видит человек. Поэтому и собираем
 * Date в местной зоне: в ISO уедет правильный сдвиг, и в CRM сообщение ляжет
 * своим временем, а не временем заливки.
 *
 * Отдельный модуль (а не пара строк в адаптере) ровно потому, что это разбор
 * чужого формата: он покрыт тестами и чинится независимо от DOM-селекторов.
 */

/**
 * Месяц по первым трём буквам — так одинаково ловятся «августа», «август» и
 * «August». Три буквы различают все месяцы в обоих языках («мар» ≠ «мая»).
 * @type {Record<string, number>}
 */
const MONTHS = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5,
  июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** «28.08.2026, 10:14:31» — месяц числом. */
const NUMERIC_DATE = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
/** «28 августа 2026, 10:14:31» — месяц словом. */
const NAMED_DATE = /^\s*(\d{1,2})\s+([^\s,]{3,})\s+(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/

/**
 * @param {number} year Год как он записан: двузначный трактуем как 20xx.
 * @returns {number}
 */
function fullYear(year) {
  return year < 100 ? 2000 + year : year
}

/**
 * Подсказка времени → ISO-строка. Ничего не понял — null: пусть лучше время
 * проставит сервер, чем в карточку уедет выдуманная дата.
 *
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
export function parseBubbleTitleDate(title) {
  if (!title) return null
  // Первая строка — время отправки; ниже могут идти «Edited»/«Original».
  const line = String(title).split("\n")[0]

  let day = 0
  let month = -1
  let year = 0
  let hours = 0
  let minutes = 0
  let seconds = 0

  const numeric = NUMERIC_DATE.exec(line)
  const named = numeric ? null : NAMED_DATE.exec(line)

  if (numeric) {
    day = Number(numeric[1])
    month = Number(numeric[2]) - 1
    year = fullYear(Number(numeric[3]))
    hours = Number(numeric[4])
    minutes = Number(numeric[5])
    seconds = Number(numeric[6] ?? 0)
  } else if (named) {
    day = Number(named[1])
    const key = named[2].toLowerCase().slice(0, 3)
    month = MONTHS[key] ?? -1
    year = fullYear(Number(named[3]))
    hours = Number(named[4])
    minutes = Number(named[5])
    seconds = Number(named[6] ?? 0)
  } else {
    return null
  }

  if (month < 0 || month > 11) return null
  if (day < 1 || day > 31) return null
  if (hours > 23 || minutes > 59 || seconds > 59) return null

  const date = new Date(year, month, day, hours, minutes, seconds)
  // Отсеиваем «31 февраля»: JS такую дату молча переносит на март.
  if (date.getMonth() !== month || date.getDate() !== day) return null
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
