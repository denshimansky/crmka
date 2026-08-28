import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { AI_REPLY_SYSTEM, buildClientContext, buildConversationText } from "@/lib/ext/ai-reply"
import type { ClientFacts } from "@/lib/ext/quick-info"

// Контекст — это всё, что модель знает о клиенте. Ошибка здесь означает либо
// выдуманный моделью ответ (данных не дали), либо утечку лишнего в текст,
// который сотрудник отправит родителю.

const norm = (s: string) => s.replace(/\s/g, " ")

function facts(patch: Partial<ClientFacts> = {}): ClientFacts {
  return {
    clientName: "Малафеева Анна",
    parentFirstName: "Анна",
    branchName: "Центральный",
    balance: 0,
    currency: "RUB",
    showNames: false,
    wards: [],
    ...patch,
  }
}

describe("buildConversationText", () => {
  it("роли называются явно — иначе модель отвечает от лица родителя", () => {
    assert.equal(
      buildConversationText([
        { direction: "incoming", text: "Здравствуйте, а когда занятие?" },
        { direction: "outgoing", text: "Добрый день! Уточню." },
      ]),
      "Родитель: Здравствуйте, а когда занятие?\nМы: Добрый день! Уточню.",
    )
  })

  it("берём только хвост переписки", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      direction: "incoming" as const,
      text: `сообщение ${i + 1}`,
    }))
    const text = buildConversationText(many) ?? ""
    assert.equal(text.split("\n").length, 10)
    assert.ok(text.includes("сообщение 15"), "последнее сообщение обязано попасть")
    assert.ok(!text.includes("сообщение 5"), "старое сообщение не нужно")
  })

  it("пустые сообщения выкидываем", () => {
    assert.equal(
      buildConversationText([
        { direction: "incoming", text: "   " },
        { direction: "incoming", text: "Вопрос" },
      ]),
      "Родитель: Вопрос",
    )
  })

  it("длинное сообщение обрезается", () => {
    const long = "а".repeat(1000)
    const text = buildConversationText([{ direction: "incoming", text: long }]) ?? ""
    assert.ok(text.length < 700, `слишком длинный контекст: ${text.length}`)
  })

  it("переписки нет — null, блок в промпт не пойдёт", () => {
    assert.equal(buildConversationText([]), null)
  })
})

describe("buildClientContext", () => {
  it("имя родителя, ребёнок, занятие и остаток", () => {
    const text = norm(
      buildClientContext(
        facts({
          wards: [
            {
              name: "Дима",
              lessons: [
                { date: "2026-09-01", startTime: "17:00", direction: "Развивайка", room: null },
              ],
              subscriptions: [
                {
                  direction: "Развивайка",
                  periodYear: 2026,
                  periodMonth: 9,
                  totalLessons: 8,
                  remainingLessons: 1,
                  debt: 650,
                },
              ],
            },
          ],
        }),
      ),
    )
    assert.ok(text.includes("Родитель: Анна"), text)
    assert.ok(text.includes("Ребёнок: Дима"), text)
    assert.ok(text.includes("ближайшее занятие 01.09 (вт) 17:00 — Развивайка"), text)
    assert.ok(text.includes("осталось 1 занятие"), `склонение: ${text}`)
    assert.ok(text.includes("к оплате 650 ₽"), text)
  })

  it("минус на балансе подаётся как задолженность", () => {
    assert.ok(norm(buildClientContext(facts({ balance: -1500 }))).includes("Задолженность по балансу: 1 500 ₽"))
  })

  it("плюс — как деньги на балансе", () => {
    assert.ok(norm(buildClientContext(facts({ balance: 1200 }))).includes("На балансе: 1 200 ₽"))
  })

  it("нулевой баланс не упоминается: это не новость для родителя", () => {
    assert.ok(!buildClientContext(facts({ balance: 0 })).includes("баланс"))
  })

  it("долга нет — про оплату молчим", () => {
    const text = buildClientContext(
      facts({
        wards: [
          {
            name: "Дима",
            lessons: [],
            subscriptions: [
              {
                direction: "Развивайка",
                periodYear: 2026,
                periodMonth: 9,
                totalLessons: 8,
                remainingLessons: 5,
                debt: 0,
              },
            ],
          },
        ],
      }),
    )
    assert.ok(!text.includes("к оплате"), text)
  })
})

describe("инструкции модели", () => {
  it("запрещают выдумывать обещания — это главный риск черновика", () => {
    assert.match(AI_REPLY_SYSTEM, /НЕ обещай/)
    assert.match(AI_REPLY_SYSTEM, /перенос занятия/)
    assert.match(AI_REPLY_SYSTEM, /возврат/i)
    assert.match(AI_REPLY_SYSTEM, /скидк/i)
  })

  it("говорят, что это черновик, а отправляет человек", () => {
    assert.match(AI_REPLY_SYSTEM, /ЧЕРНОВИК/)
    assert.match(AI_REPLY_SYSTEM, /отправит сам/)
  })
})
