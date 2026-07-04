/**
 * Unit-тесты разбора ФИО родителя при импорте из 1С (этап 1).
 *  - «Контактное лицо» = имя → фамилия ребёнка + имя (согласование по полу);
 *  - «Контактное лицо» = имя + отчество → отчество сохраняется;
 *  - «Контактное лицо» = полное ФИО → ячейка берётся целиком, фамилия ребёнка
 *    не трогается («Иванова Иванова» больше не возникает);
 *  - одинокая фамилия / инициалы / нераспознанные слова → пометка «Проверить»;
 *  - splitParentFio раскладывает «Фамилия Имя Отчество» по полям клиента.
 *
 * Чистая логика без БД (как leads-import-branch.test.ts).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { parentFullName, splitParentFio } from "../lib/leads-import/surname-gender"
import { processLeads, type ProcessResult } from "../lib/leads-import/process-leads"
import { readSheet } from "../lib/leads-import/parse-xlsx"

describe("parentFullName — имя в «Контактном лице» (классический путь)", () => {
  it("имя: фамилия ребёнка согласуется по полу родителя", () => {
    const r = parentFullName("Иванов Петя", "Мария")
    assert.equal(r.full, "Иванова Мария")
    assert.equal(r.needsReview, false)
    assert.equal(r.changed, true)
    assert.equal(r.fromContact, false)
  })

  it("имя + отчество: отчество сохраняется", () => {
    const r = parentFullName("Иванова Катя", "Мария Петровна")
    assert.equal(r.full, "Иванова Мария Петровна")
    assert.equal(r.needsReview, false)
    assert.equal(r.fromContact, false)
  })

  it("слово-отношение отбрасывается: «мама Оля» → имя Оля", () => {
    const r = parentFullName("Иванова Катя", "мама Оля")
    assert.equal(r.full, "Иванова Оля")
    assert.equal(r.fromContact, false)
  })

  it("только слово-отношение → остаётся фамилия ребёнка + «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "бабушка")
    assert.equal(r.full, "Иванова")
    assert.equal(r.needsReview, true)
  })

  it("одинокая фамилия вместо имени → «Проверить» (раньше проходило молча)", () => {
    const r = parentFullName("Иванова Катя", "Смирнова")
    assert.equal(r.needsReview, true)
  })
})

describe("parentFullName — полное ФИО в «Контактном лице»", () => {
  it("«Фамилия Имя» берётся целиком, фамилия ребёнка не трогается", () => {
    const r = parentFullName("Иванов Петя", "Иванова Мария")
    assert.equal(r.full, "Иванова Мария")
    assert.equal(r.needsReview, false)
    assert.equal(r.changed, false)
    assert.equal(r.fromContact, true)
  })

  it("чужая фамилия: «Петрова Смирнова» больше не возникает", () => {
    const r = parentFullName("Петрова Аня", "Смирнова Ольга")
    assert.equal(r.full, "Смирнова Ольга")
    assert.equal(r.needsReview, false)
    assert.equal(r.fromContact, true)
  })

  it("«Фамилия Имя Отчество» берётся целиком", () => {
    const r = parentFullName("Петров Ваня", "Смирнова Ольга Ивановна")
    assert.equal(r.full, "Смирнова Ольга Ивановна")
    assert.equal(r.needsReview, false)
  })

  it("«Имя Фамилия» переставляется в «Фамилия Имя»", () => {
    const r = parentFullName("Иванова Катя", "Мария Иванова")
    assert.equal(r.full, "Иванова Мария")
    assert.equal(r.needsReview, false)
    assert.equal(r.fromContact, true)
  })

  it("«Имя Отчество Фамилия» переставляется в «Фамилия Имя Отчество»", () => {
    const r = parentFullName("Петров Ваня", "Ольга Ивановна Смирнова")
    assert.equal(r.full, "Смирнова Ольга Ивановна")
    assert.equal(r.needsReview, false)
  })

  it("мужское полное ФИО", () => {
    const r = parentFullName("Гаджиева Лейла", "Гаджиев Марат")
    assert.equal(r.full, "Гаджиев Марат")
    assert.equal(r.needsReview, false)
  })

  it("фамилия + инициалы → целиком, но с пометкой «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Иванова М.П.")
    assert.equal(r.full, "Иванова М.П.")
    assert.equal(r.needsReview, true)
    assert.equal(r.fromContact, true)
  })

  it("имя + слово вне словарей: слово вперёд как фамилию + «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Мария Кулик")
    assert.equal(r.full, "Кулик Мария")
    assert.equal(r.needsReview, true)
  })

  it("два имени → как есть + «Проверить»", () => {
    const r = parentFullName("Петрова Аня", "Ирина Полина")
    assert.equal(r.full, "Ирина Полина")
    assert.equal(r.needsReview, true)
  })
})

describe("parentFullName — находки адверсариального ревью", () => {
  it("тюркское отчество «Мамед оглы» — не фамилия, склеивается с фамилией ребёнка", () => {
    const r = parentFullName("Мамедов Эльвин", "Руслан Мамед оглы")
    assert.equal(r.full, "Мамедов Руслан Мамед оглы")
    assert.equal(r.needsReview, false)
    assert.equal(r.fromContact, false)
  })

  it("тюркское женское отчество «Мамед кызы»", () => {
    const r = parentFullName("Мамедова Айгуль", "Лейла Мамед кызы")
    assert.equal(r.full, "Мамедова Лейла Мамед кызы")
    assert.equal(r.needsReview, false)
  })

  it("фамилия на -ович при женском имени — фамилия, не отчество", () => {
    const r = parentFullName("Иванова Катя", "Ольга Мицкевич")
    assert.equal(r.full, "Мицкевич Ольга")
    assert.equal(r.needsReview, false)
    assert.equal(r.fromContact, true)
  })

  it("«Наталья Абрамович» → «Абрамович Наталья», фамилия ребёнка не феминизируется", () => {
    const r = parentFullName("Петров Ваня", "Наталья Абрамович")
    assert.equal(r.full, "Абрамович Наталья")
    assert.equal(r.needsReview, false)
    assert.equal(r.changed, false)
  })

  it("«Ольга Ивановна Мицкевич» → «Мицкевич Ольга Ивановна»", () => {
    const r = parentFullName("Иванова Катя", "Ольга Ивановна Мицкевич")
    assert.equal(r.full, "Мицкевич Ольга Ивановна")
    assert.equal(r.needsReview, false)
  })

  it("контроль: настоящее мужское отчество работает как раньше", () => {
    const r = parentFullName("Иванов Петя", "Сергей Петрович")
    assert.equal(r.full, "Иванов Сергей Петрович")
    assert.equal(r.needsReview, false)
  })

  it("имя вне словаря + отчество: пол из отчества, фамилия ребёнка сохраняется", () => {
    const r = parentFullName("Смирнова Аня", "Ратмир Петрович")
    assert.equal(r.full, "Смирнов Ратмир Петрович")
    assert.equal(r.needsReview, false)
    assert.equal(r.changed, true)
  })

  it("одинокое отчество → «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Петровна")
    assert.equal(r.needsReview, true)
  })

  it("две фамилии-кандидата → «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Мария Иванова Петрова")
    assert.equal(r.needsReview, true)
  })

  it("инициал в хвосте → «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Иванова Мария П.")
    assert.equal(r.needsReview, true)
  })

  it("мусорное слово рядом с распознанным ФИО → «Проверить»", () => {
    const r = parentFullName("Иванова Катя", "Иванова Мария тел123")
    assert.equal(r.needsReview, true)
  })

  it("«Дед» с заглавной буквы — не отбрасывается как слово-отношение", () => {
    const r = parentFullName("Дед Маша", "Пётр Дед")
    assert.equal(r.full, "Дед Пётр")
    assert.equal(r.needsReview, true)
  })

  it("пустое ФИО ребёнка → «Проверить»", () => {
    const r = parentFullName("", "Мария Петровна")
    assert.equal(r.full, "Мария Петровна")
    assert.equal(r.needsReview, true)
  })
})

describe("splitParentFio — разбор «Фамилия Имя [Отчество]» на поля клиента", () => {
  it("три слова с отчеством → отдельное поле", () => {
    assert.deepEqual(splitParentFio("Иванова Мария Петровна"), {
      lastName: "Иванова",
      firstName: "Мария",
      patronymic: "Петровна",
    })
  })

  it("два слова → отчества нет", () => {
    assert.deepEqual(splitParentFio("Иванова Мария"), {
      firstName: "Мария",
      lastName: "Иванова",
      patronymic: null,
    })
  })

  it("три слова без отчества → всё после фамилии остаётся именем", () => {
    assert.deepEqual(splitParentFio("Иванова М.П. вторая"), {
      firstName: "М.П. вторая",
      lastName: "Иванова",
      patronymic: null,
    })
  })

  it("естественный порядок «Имя Отчество Фамилия» (ручная правка)", () => {
    assert.deepEqual(splitParentFio("Ольга Ивановна Мицкевич"), {
      lastName: "Мицкевич",
      firstName: "Ольга",
      patronymic: "Ивановна",
    })
  })

  it("фамилия на -ович при женском имени не считается отчеством", () => {
    assert.deepEqual(splitParentFio("Иванова Ольга Мицкевич"), {
      firstName: "Ольга Мицкевич",
      lastName: "Иванова",
      patronymic: null,
    })
  })

  it("тюркское отчество из двух слов", () => {
    assert.deepEqual(splitParentFio("Мамедов Руслан Мамед оглы"), {
      lastName: "Мамедов",
      firstName: "Руслан",
      patronymic: "Мамед оглы",
    })
  })

  it("контроль: совместимое отчество распознаётся", () => {
    assert.deepEqual(splitParentFio("Иванов Сергей Петрович"), {
      lastName: "Иванов",
      firstName: "Сергей",
      patronymic: "Петрович",
    })
  })
})

// ─── Интеграция: полный прогон этапа 1 ───

const HEADERS = ["ФИО", "Контактное лицо", "Телефон", "Состояние лида", "Филиал"]

function buildInput(rows: Record<string, string>[]): Buffer {
  const aoa = [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ""))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Лист_1")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("Импорт базы — этап 1: полное ФИО в «Контактном лице»", () => {
  it("полное ФИО попадает в промежуточный файл целиком и считается в статистике", () => {
    const buf = buildInput([
      {
        "ФИО": "Иванов Петя",
        "Контактное лицо": "Иванова Мария Петровна",
        "Телефон": "+7 900 111-11-11",
        "Состояние лида": "Выбыл",
        "Филиал": "СОЦ",
      },
      {
        "ФИО": "Петров Ваня",
        "Контактное лицо": "Мария",
        "Телефон": "+7 900 222-22-22",
        "Состояние лида": "Выбыл",
        "Филиал": "СОЦ",
      },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true, "конфликтов быть не должно")
    const ok = result as ProcessResult

    const out = readSheet(ok.fileBuffer, { headerRow: 0 })
    const ivanov = out.find((r) => String(r["Ребёнок"]).startsWith("Иванов"))
    assert.ok(ivanov, "строка Иванова найдена")
    assert.equal(ivanov!["Фамилия Имя родителя"], "Иванова Мария Петровна")
    assert.equal(ivanov!["Проверить"], "", "уверенное полное ФИО — без пометки")

    const petrov = out.find((r) => String(r["Ребёнок"]).startsWith("Петров"))
    assert.equal(petrov!["Фамилия Имя родителя"], "Петрова Мария", "классический путь не сломан")

    assert.equal(ok.stats.parentFromContact, 1, "одно ФИО взято из «Контактного лица» целиком")
    assert.equal(ok.stats.surnameChanged, 1, "одна фамилия согласована (Петров → Петрова)")
  })

  it("фамилия + инициалы → строка уходит на проверку", () => {
    const buf = buildInput([
      {
        "ФИО": "Иванова Катя",
        "Контактное лицо": "Иванова М.П.",
        "Телефон": "+7 900 333-33-33",
        "Состояние лида": "Выбыл",
        "Филиал": "СОЦ",
      },
    ])
    const result = processLeads(buf)
    assert.equal(result.ok, true)
    const ok = result as ProcessResult
    const out = readSheet(ok.fileBuffer, { headerRow: 0 })
    assert.equal(out[0]["Проверить"], "да")
    assert.equal(ok.stats.needsReview, 1)
  })
})
