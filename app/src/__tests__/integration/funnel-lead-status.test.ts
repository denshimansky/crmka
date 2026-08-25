/**
 * Регрессия: этап «Лид» воронки = контакты, СТАВШИЕ лидом (вошедшие в статус
 * «Новый») в выбранном месяце — независимо от их текущего статуса.
 *  - ручной лид («Новый») → +1;
 *  - тот же лид, переведённый в другой статус (потенциал/актив) → ОСТАЁТСЯ в счёте
 *    месяца (ключевой кейс: считается момент входа в статус, а не текущий статус);
 *  - контакт, созданный сразу в нелид-статусе («Архив») → +0.
 *
 * Через HTTP на dev-сервере (как trial-funnel.test.ts). Скип без seed/auth.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "../helpers"

// Интеграционные HTTP-тесты бьют по реальному серверу. Без TEST_BASE_URL (нет
// засеянного тестового сервера) весь набор скипается — так локальный прогон не
// стучится в сеть и не шумит. Запуск: TEST_BASE_URL=... npm run test:integration
const suite = process.env.TEST_BASE_URL ? describe : describe.skip

async function leadCount(cookie: string): Promise<number> {
  const res = await apiCall("GET", "/api/reports/funnel", { cookie })
  const funnel: any[] = res.data?.data?.funnel ?? []
  const lead = funnel.find((s) => s.status === "lead")
  return lead ? Number(lead.count) : NaN
}

suite("Воронка: «Лид» = стал лидом в этом месяце (по входу в статус)", () => {
  let cookie: string | null = null
  const cleanup: string[] = []

  before(async () => {
    cookie = await getAuthCookie("owner")
  })

  it("Новый → +1; перевод в др. статус НЕ убирает; Архив → +0", async (t) => {
    if (!cookie) { t.skip("Auth недоступна (seed не применён?)"); return }
    const c = cookie
    const suffix = Date.now().toString().slice(-7)

    const base = await leadCount(c)
    if (Number.isNaN(base)) { t.skip("Воронка недоступна"); return }

    // 1) Ручной лид (статус «Новый» по умолчанию) — +1.
    const r1 = await apiCall("POST", "/api/clients", {
      cookie: c,
      body: { firstName: "Новый", lastName: `Лид${suffix}`, phone: `+7901${suffix}` },
    })
    assert.equal(r1.status, 201, `новый лид создан: ${JSON.stringify(r1.data)}`)
    cleanup.push(r1.data.id)
    const afterNew = await leadCount(c)
    assert.equal(afterNew, base + 1, "лид «Новый» увеличил «Лид» на 1")

    // 2) КЛЮЧЕВОЙ КЕЙС: переводим лида в другой статус — он ОСТАЁТСЯ в счёте месяца
    //    (becameLeadAt уже проставлен, текущий статус роли не играет).
    const patch = await apiCall("PATCH", `/api/clients/${r1.data.id}`, {
      cookie: c,
      body: { funnelStatus: "potential" },
    })
    assert.equal(patch.status, 200, `статус изменён: ${JSON.stringify(patch.data)}`)
    const afterMove = await leadCount(c)
    assert.equal(afterMove, afterNew, "переведённый из «Нового» лид ОСТАЛСЯ в счёте месяца")

    // 3) Контакт, созданный сразу в нелид-статусе («Архив») — НЕ меняет «Лид».
    const r3 = await apiCall("POST", "/api/clients", {
      cookie: c,
      body: {
        firstName: "Архивный",
        lastName: `Контакт${suffix}`,
        phone: `+7902${suffix}`,
        funnelStatus: "archived",
      },
    })
    assert.equal(r3.status, 201, `архивный контакт создан: ${JSON.stringify(r3.data)}`)
    cleanup.push(r3.data.id)
    const afterArchived = await leadCount(c)
    assert.equal(afterArchived, afterMove, "контакт, созданный «Архивом», НЕ увеличил «Лид»")
  })

  after(async () => {
    if (!cookie) return
    for (const id of cleanup) {
      await apiCall("DELETE", `/api/clients/${id}`, { cookie })
    }
  })
})
