/**
 * Тесты мультитенантности — изоляция данных между организациями.
 * Все тесты с auth скипаются если seed не применён.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null

describe("Мультитенантность — изоляция данных (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  const endpoints: [string, string][] = [
    ["clients", "/api/clients"],
    ["payments", "/api/payments"],
    ["expenses", "/api/expenses"],
    ["subscriptions", "/api/subscriptions"],
    ["groups", "/api/groups"],
    ["salary-payments", "/api/salary-payments"],
  ]

  for (const [name, path] of endpoints) {
    it(`GET ${path} — все записи одного tenantId`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", path, { cookie: ownerCookie })
      assert.equal(res.status, 200)
      if (Array.isArray(res.data) && res.data.length > 0) {
        const tenantIds = [...new Set(res.data.map((r: any) => r.tenantId))]
        assert.equal(tenantIds.length, 1, `${name}: все записи одного tenant, получили ${tenantIds.length}`)
      }
    })
  }

  it("GET /api/clients/:fakeId — чужой ID → 404", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const fakeId = "00000000-0000-0000-0000-000000000001"
    const res = await apiCall("GET", `/api/clients/${fakeId}`, { cookie: ownerCookie })
    assert.ok(
      res.status === 404 || (res.status === 200 && res.data === null),
      `Чужой ID не доступен (status: ${res.status})`
    )
  })

  it("GET /api/clients — deletedAt === null для всех записей", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/clients", { cookie: ownerCookie })
    assert.equal(res.status, 200)
    if (Array.isArray(res.data)) {
      const deleted = res.data.filter((c: any) => c.deletedAt !== null)
      assert.equal(deleted.length, 0, "Нет удалённых записей в ответе")
    }
  })
})
