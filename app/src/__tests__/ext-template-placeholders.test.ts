import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  EMPTY_VALUE,
  TEMPLATE_PLACEHOLDERS,
  expandTemplate,
} from "@/lib/ext/template-placeholders"

// Подстановка идёт в текст, который сотрудник отправит родителю. Правила
// поведения здесь важнее самого кода: что происходит с опечаткой, с «ё», с
// отсутствующими данными.

describe("expandTemplate", () => {
  const values = { ребёнок: "Дима", остаток: "5", долг: "650 ₽" }

  it("подставляет значения", () => {
    assert.equal(
      expandTemplate("У {ребёнок} осталось {остаток} занятий.", values),
      "У Дима осталось 5 занятий.",
    )
  })

  it("«е» вместо «ё» — тот же плейсхолдер", () => {
    assert.equal(expandTemplate("Привет, {ребенок}!", values), "Привет, Дима!")
  })

  it("регистр и пробелы внутри скобок не мешают", () => {
    assert.equal(expandTemplate("{ Ребёнок }", values), "Дима")
  })

  it("один плейсхолдер несколько раз", () => {
    assert.equal(expandTemplate("{ребёнок} и ещё раз {ребёнок}", values), "Дима и ещё раз Дима")
  })

  it("незнакомый плейсхолдер остаётся в тексте — опечатку видно до отправки", () => {
    assert.equal(
      expandTemplate("Здравствуйте, {ребенк}!", values),
      "Здравствуйте, {ребенк}!",
    )
  })

  it("текст без плейсхолдеров не меняется", () => {
    assert.equal(expandTemplate("Просто текст", values), "Просто текст")
  })

  it("пустые скобки не ломают разбор", () => {
    assert.equal(expandTemplate("{} и {ребёнок}", values), "{} и Дима")
  })

  it("многострочный текст сохраняет переводы строк", () => {
    assert.equal(
      expandTemplate("Здравствуйте!\nУ {ребёнок} долг {долг}.", values),
      "Здравствуйте!\nУ Дима долг 650 ₽.",
    )
  })

  it("пустая строка как значение — это значение, а не «нет ключа»", () => {
    assert.equal(expandTemplate("[{остаток}]", { остаток: "" }), "[]")
  })
})

describe("каталог плейсхолдеров", () => {
  it("ключи уникальны — иначе на странице будут две одинаковые кнопки", () => {
    const keys = TEMPLATE_PLACEHOLDERS.map((p) => p.key)
    assert.equal(new Set(keys).size, keys.length)
  })

  it("ключи без пробелов и скобок: их вставляют прямо в текст", () => {
    for (const { key } of TEMPLATE_PLACEHOLDERS) {
      assert.match(key, /^[a-zа-яё_]+$/i, `ключ «${key}» не годится для {фигурных скобок}`)
    }
  })

  it("у каждого ключа есть подсказка — иначе кнопка ни о чём", () => {
    for (const { key, hint } of TEMPLATE_PLACEHOLDERS) {
      assert.ok(hint.trim().length > 0, `нет подсказки у «${key}»`)
    }
  })

  it("заглушка пустого значения заметна глазом", () => {
    assert.equal(EMPTY_VALUE, "—")
  })
})

describe("остаток: число и число со словом — разные плейсхолдеры", () => {
  it("оба ключа есть в каталоге", () => {
    const keys = TEMPLATE_PLACEHOLDERS.map((p) => p.key)
    assert.ok(keys.includes("остаток"), "нужен «{остаток}» — голое число")
    assert.ok(keys.includes("остаток_занятий"), "нужен «{остаток_занятий}» — со словом")
  })

  it("в живой фразе используется вариант со словом", () => {
    assert.equal(
      expandTemplate("Осталось {остаток_занятий}.", { остаток_занятий: "1 занятие" }),
      "Осталось 1 занятие.",
    )
  })
})
