import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  stem,
  stems,
  scoreRow,
  selectFaq,
  renderFaqBlock,
  DEFAULT_LIMIT,
  type FaqRow,
} from "../lib/ai-faq-select"

/**
 * Отбор записей ai_faq под вопрос (31.08.2026). Раньше в промпт шли ВСЕ записи;
 * теперь ядро + подборка, поэтому цена ошибки отбора высокая: не нашли запись —
 * ассистент отвечает без неё и снова выдумывает интерфейс.
 */

const row = (q: string, a = "ответ", kw: string | null = null, isCore = false): FaqRow => ({
  question: q,
  answer: a,
  keywords: kw,
  isCore,
})

describe("stem", () => {
  it("склеивает падежи по первым 5 символам", () => {
    assert.equal(stem("абонемент"), stem("абонементы"))
    assert.equal(stem("абонемент"), stem("абонементу"))
    assert.equal(stem("группа"), stem("группы"))
    assert.equal(stem("группа"), stem("группе"))
  })

  it("нормализует ё — пользователи пишут и так, и так", () => {
    assert.equal(stem("счёт"), stem("счет"))
    assert.equal(stem("отчёты"), stem("отчеты"))
  })

  it("короткие слова не режет", () => {
    assert.equal(stem("лид"), "лид")
    assert.equal(stem("касса"), "касса")
  })

  it("не склеивает разные темы", () => {
    assert.notEqual(stem("расход"), stem("расписание"))
    assert.notEqual(stem("отчисление"), stem("отчёт"))
  })
})

describe("stems", () => {
  it("выкидывает служебные слова, оставляет доменные", () => {
    const s = stems("Подскажите пожалуйста, как мне удалить абонемент?")
    assert.ok(!s.has(stem("подскажите")), "подскажите — служебное")
    assert.ok(!s.has(stem("пожалуйста")), "пожалуйста — служебное")
    assert.ok(s.has(stem("удалить")))
    assert.ok(s.has(stem("абонемент")))
  })

  it("доменные слова НЕ стоп-слова (в отличие от детектора сущностей)", () => {
    const s = stems("где абонемент клиента и группа")
    assert.ok(s.has(stem("абонемент")))
    assert.ok(s.has(stem("клиента")))
    assert.ok(s.has(stem("группа")))
  })

  it("игнорирует слова короче 4 символов и цифры", () => {
    const s = stems("как мне 500 руб")
    assert.equal(s.size, 0)
  })
})

describe("scoreRow", () => {
  it("совпадение в вопросе весит больше, чем в ответе", () => {
    const q = stems("отчисление")
    const inQuestion = scoreRow(row("Как оформить отчисление", "текст"), q)
    const inAnswer = scoreRow(row("Другая тема", "тут про отчисление"), q)
    assert.ok(inQuestion > inAnswer)
  })

  it("ключевые слова тоже поднимают запись", () => {
    const q = stems("кошелёк")
    const withKw = scoreRow(row("Перевод в ожидание оплаты", "текст", "кошелек, иконка"), q)
    const withoutKw = scoreRow(row("Перевод в ожидание оплаты", "текст"), q)
    assert.ok(withKw > withoutKw)
  })

  it("пустой вопрос даёт ноль", () => {
    assert.equal(scoreRow(row("Что угодно", "текст"), stems("ок")), 0)
  })
})

describe("selectFaq", () => {
  const rows: FaqRow[] = [
    row("Общие правила ответов", "не выдумывай кнопки", null, true),
    row("Как выписать абонемент клиенту", "через воронку продаж"),
    row("Как удалить оплату", "иконка корзины на странице Оплаты"),
    row("Как провести разовый мастер-класс", "кнопка Занятие в расписании"),
  ]

  it("ядро возвращается всегда, даже без совпадений", () => {
    const { core, matched } = selectFaq(rows, "ок")
    assert.equal(core.length, 1)
    assert.equal(matched.length, 0)
  })

  it("ядро не попадает в подборку повторно", () => {
    const { core, matched } = selectFaq(rows, "какие общие правила ответов")
    assert.equal(core.length, 1)
    assert.ok(!matched.some((r) => r.isCore), "ядровая запись задвоилась бы в промпте")
  })

  it("находит запись по теме вопроса", () => {
    const { matched } = selectFaq(rows, "как выписать абонемент")
    assert.equal(matched[0].question, "Как выписать абонемент клиенту")
  })

  it("находит запись, даже если падеж другой", () => {
    const { matched } = selectFaq(rows, "нужно удалить ошибочные оплаты")
    assert.equal(matched[0].question, "Как удалить оплату")
  })

  it("не тащит записи без единого совпадения", () => {
    const { matched } = selectFaq(rows, "мастер-класс")
    assert.equal(matched.length, 1)
    assert.equal(matched[0].question, "Как провести разовый мастер-класс")
  })

  it("режет по лимиту, оставляя самые релевантные", () => {
    const many: FaqRow[] = [
      ...Array.from({ length: 30 }, (_, i) => row(`Тема ${i}`, "тут упоминается абонемент")),
      row("Как выписать абонемент клиенту", "абонемент абонемент"),
    ]
    const { matched } = selectFaq(many, "абонемент", 5)
    assert.equal(matched.length, 5)
    assert.equal(matched[0].question, "Как выписать абонемент клиенту")
  })

  it("при равном совпадении сохраняет исходный порядок — выдача не плавает", () => {
    const same: FaqRow[] = [row("Первая про оплату"), row("Вторая про оплату")]
    const a = selectFaq(same, "оплата")
    const b = selectFaq(same, "оплата")
    assert.deepEqual(
      a.matched.map((r) => r.question),
      b.matched.map((r) => r.question),
    )
    assert.equal(a.matched[0].question, "Первая про оплату")
  })

  it("лимит по умолчанию с запасом над проверенным минимумом", () => {
    // На реальных вопросах нужная запись попадала в подборку при лимите 10;
    // ниже опускать нельзя — начинаются промахи на коротких вопросах.
    assert.ok(DEFAULT_LIMIT >= 10)
  })
})

describe("renderFaqBlock", () => {
  it("пустой список — пустая строка, без осиротевшего заголовка", () => {
    assert.equal(renderFaqBlock([], "core"), "")
    assert.equal(renderFaqBlock([], "matched"), "")
  })

  it("подборка честно помечена как неполная", () => {
    const text = renderFaqBlock([row("Как удалить оплату")], "matched")
    assert.ok(
      text.includes("не весь объём знаний"),
      "без этой оговорки модель отвечает «такого в системе нет» на всё, чего нет в подборке",
    )
  })

  it("в блок попадают и вопрос, и ответ", () => {
    const text = renderFaqBlock([row("Как удалить оплату", "иконка корзины")], "matched")
    assert.ok(text.includes("Как удалить оплату"))
    assert.ok(text.includes("иконка корзины"))
  })
})
