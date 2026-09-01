import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  dateOrderForLocale,
  parsePrePlainText,
  parseWhatsappSentAt,
  phoneFromAuthorLabel,
} from "../common/wa-time.js"

// Время в WhatsApp есть ТОЛЬКО в data-pre-plain-text, и формат его зависит от
// языка интерфейса. Публичные скраперы разбирают это регуляркой «месяц/день/год»
// и на русском интерфейсе молча получают дату из другого месяца.

describe("parsePrePlainText", () => {
  it("русский интерфейс", () => {
    assert.deepEqual(parsePrePlainText("[16:04, 12.08.2026] Мама Пети: "), {
      time: "16:04",
      date: "12.08.2026",
      author: "Мама Пети",
    })
  })
  it("английский интерфейс, 12-часовой формат", () => {
    const parsed = parsePrePlainText("[4:04 PM, 8/12/2026] Maria: ")
    assert.equal(parsed?.time, "4:04 PM")
    assert.equal(parsed?.date, "8/12/2026")
  })
  it("исходящее без имени", () => {
    const parsed = parsePrePlainText("[16:07, 12.08.2026] ")
    assert.equal(parsed?.time, "16:07")
    assert.equal(parsed?.author, null)
  })
  it("несохранённый контакт — вместо имени номер", () => {
    assert.equal(parsePrePlainText("[9:15, 01.09.2026] +7 900 123-45-67: ")?.author, "+7 900 123-45-67")
  })
  it("не та строка — null", () => {
    assert.equal(parsePrePlainText("16:04"), null)
    assert.equal(parsePrePlainText("[16:04 12.08.2026]"), null)
    assert.equal(parsePrePlainText(null), null)
  })
})

describe("dateOrderForLocale", () => {
  it("русская локаль — день, месяц, год", () => {
    assert.deepEqual(dateOrderForLocale("ru-RU"), ["day", "month", "year"])
  })
  it("американская — месяц, день, год", () => {
    assert.deepEqual(dateOrderForLocale("en-US"), ["month", "day", "year"])
  })
  it("британская — день, месяц, год", () => {
    assert.deepEqual(dateOrderForLocale("en-GB"), ["day", "month", "year"])
  })
})

describe("parseWhatsappSentAt", () => {
  /** Локальное время → ISO: тот же путь, что и в разбираемом коде. */
  const iso = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0).toISOString()

  it("русский интерфейс: 12.08.2026 — это ДВЕНАДЦАТОЕ АВГУСТА", () => {
    // Наивная регулярка «месяц/день/год» дала бы 8 декабря — ошибка тихая, и
    // заметили бы её через недели по датам в карточке.
    assert.equal(
      parseWhatsappSentAt("[16:04, 12.08.2026] Мама Пети: ", "ru-RU"),
      iso(2026, 8, 12, 16, 4),
    )
  })
  it("американский интерфейс: 8/12/2026 — тоже двенадцатое августа", () => {
    assert.equal(
      parseWhatsappSentAt("[4:04 PM, 8/12/2026] Maria: ", "en-US"),
      iso(2026, 8, 12, 16, 4),
    )
  })
  it("полночь и полдень в 12-часовом формате", () => {
    assert.equal(parseWhatsappSentAt("[12:00 AM, 1/5/2026] A: ", "en-US"), iso(2026, 1, 5, 0, 0))
    assert.equal(parseWhatsappSentAt("[12:30 PM, 1/5/2026] A: ", "en-US"), iso(2026, 1, 5, 12, 30))
  })
  it("узкий неразрывный пробел перед AM/PM (его ставит современный ICU)", () => {
    assert.equal(
      parseWhatsappSentAt("[4:04 PM, 8/12/2026] Maria: ", "en-US"),
      iso(2026, 8, 12, 16, 4),
    )
  })
  it("порядок в локали не совпал с данными — верим данным", () => {
    // Локаль говорит «месяц первый», а первое число 25 — месяцем быть не может.
    assert.equal(parseWhatsappSentAt("[10:00, 25.12.2026] A: ", "en-US"), iso(2026, 12, 25, 10, 0))
  })
  it("двузначный год достраивается", () => {
    assert.equal(parseWhatsappSentAt("[10:00, 12.08.26] A: ", "ru-RU"), iso(2026, 8, 12, 10, 0))
  })
  it("несуществующая дата не проскакивает молча", () => {
    // Date переполняет «31 февраля» в 3 марта — для нас это признак, что разбор
    // пошёл не туда, а не повод записать сообщение неверной датой.
    assert.equal(parseWhatsappSentAt("[10:00, 31.02.2026] A: ", "ru-RU"), null)
  })
  it("мусор — null, и это штатно", () => {
    // Сообщение всё равно зальётся: ключ дедупа в WhatsApp настоящий и от
    // времени не зависит, сервер поставит время заливки.
    assert.equal(parseWhatsappSentAt("", "ru-RU"), null)
    assert.equal(parseWhatsappSentAt("[25:99, 12.08.2026] A: ", "ru-RU"), null)
    assert.equal(parseWhatsappSentAt("[16:04, 12.08.1990] A: ", "ru-RU"), null)
  })
})

describe("phoneFromAuthorLabel", () => {
  it("несохранённый контакт — международный номер", () => {
    assert.equal(phoneFromAuthorLabel("+7 900 123-45-67"), "79001234567")
    assert.equal(phoneFromAuthorLabel("+91 77378 87058"), "917737887058")
  })
  it("имя из телефонной книги номером не считается", () => {
    // Штатный исход: у сохранённого контакта номера в разметке нет вовсе.
    assert.equal(phoneFromAuthorLabel("Мама Пети"), null)
    // И даже если имя начинается с плюса — по нему подставлять клиента нельзя.
    assert.equal(phoneFromAuthorLabel("+7 Мама Пети"), null)
  })
  it("слишком короткое или длинное — не номер", () => {
    assert.equal(phoneFromAuthorLabel("+7 900"), null)
    assert.equal(phoneFromAuthorLabel("+1234567890123456789"), null)
    assert.equal(phoneFromAuthorLabel(null), null)
  })
})
