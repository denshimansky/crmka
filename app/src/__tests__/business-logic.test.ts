/**
 * Тесты бизнес-логики — валидация, ссылочная целостность, soft delete.
 * Через HTTP на dev-сервере. Скипаются без seed.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null

describe("Бизнес-логика (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  describe("Zod-валидация", () => {
    it("payments — отрицательная сумма → 400", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/payments", {
        cookie: ownerCookie,
        body: { clientId: "00000000-0000-0000-0000-000000000001", accountId: "00000000-0000-0000-0000-000000000002", amount: -100, method: "cash", date: "2026-04-01" },
      })
      assert.equal(res.status, 400)
    })

    it("payments — невалидный method → 400", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/payments", {
        cookie: ownerCookie,
        body: { clientId: "00000000-0000-0000-0000-000000000001", accountId: "00000000-0000-0000-0000-000000000002", amount: 1000, method: "bitcoin", date: "2026-04-01" },
      })
      assert.equal(res.status, 400)
    })

    it("payments — невалидный UUID → 400", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/payments", {
        cookie: ownerCookie,
        body: { clientId: "not-a-uuid", accountId: "also-not-uuid", amount: 1000, method: "cash", date: "2026-04-01" },
      })
      assert.equal(res.status, 400)
    })

    it("expenses — нулевая сумма → 400", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/expenses", {
        cookie: ownerCookie,
        body: { categoryId: "00000000-0000-0000-0000-000000000001", accountId: "00000000-0000-0000-0000-000000000002", amount: 0, date: "2026-04-01" },
      })
      assert.equal(res.status, 400)
    })

    it("salary-payments — без employeeId → 400", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/salary-payments", {
        cookie: ownerCookie,
        body: { accountId: "00000000-0000-0000-0000-000000000002", amount: 5000, date: "2026-04-01", periodYear: 2026, periodMonth: 3 },
      })
      assert.equal(res.status, 400)
    })
  })

  describe("Ссылочная целостность", () => {
    it("payments — несуществующий клиент → 404", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/payments", {
        cookie: ownerCookie,
        body: { clientId: "00000000-dead-dead-dead-000000000001", accountId: "00000000-dead-dead-dead-000000000002", amount: 1000, method: "cash", date: "2026-04-01" },
      })
      assert.equal(res.status, 404)
    })

    it("expenses — несуществующая категория → 404", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", "/api/expenses", {
        cookie: ownerCookie,
        body: { categoryId: "00000000-dead-dead-dead-000000000001", accountId: "00000000-dead-dead-dead-000000000002", amount: 500, date: "2026-04-01" },
      })
      assert.equal(res.status, 404)
    })
  })

  describe("Soft delete — deletedAt фильтрация", () => {
    const endpoints: [string, string][] = [
      ["clients", "/api/clients"],
      ["payments", "/api/payments"],
      ["expenses", "/api/expenses"],
    ]
    for (const [name, path] of endpoints) {
      it(`${name} — нет deletedAt в ответе`, async (t) => {
        if (!ownerCookie) { t.skip("Auth недоступна"); return }
        const res = await apiCall("GET", path, { cookie: ownerCookie })
        assert.equal(res.status, 200)
        if (Array.isArray(res.data)) {
          const deleted = res.data.filter((r: any) => r.deletedAt !== null)
          assert.equal(deleted.length, 0, `${name}: нет удалённых записей`)
        }
      })
    }
  })

  describe("Каскадные контракты", () => {
    it("salary/accruals — 200 или 404", async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", "/api/salary/accruals?periodYear=2026&periodMonth=3", { cookie: ownerCookie })
      assert.ok([200, 404].includes(res.status), `Получили ${res.status}`)
    })
  })
})
