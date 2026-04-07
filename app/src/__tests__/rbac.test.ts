/**
 * RBAC тесты — проверяем что роли ограничивают доступ к API.
 * Тесты через HTTP на dev-сервере. Скипаются если seed не применён.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null

describe("RBAC — без авторизации → 401/redirect", () => {
  const endpoints: [string, string][] = [
    ["GET", "/api/clients"],
    ["GET", "/api/payments"],
    ["GET", "/api/expenses"],
    ["GET", "/api/salary-payments"],
    ["GET", "/api/subscriptions"],
    ["GET", "/api/groups"],
  ]

  for (const [method, path] of endpoints) {
    it(`${method} ${path} → 401/302/307`, async () => {
      const res = await apiCall(method, path)
      assert.ok(
        [401, 302, 307].includes(res.status),
        `Ожидали 401/302/307, получили ${res.status}`
      )
    })
  }
})

describe("RBAC — superadmin endpoints", () => {
  it("GET /api/admin/partners без auth → 401/403", async () => {
    const res = await apiCall("GET", "/api/admin/partners")
    assert.ok([401, 403].includes(res.status), `Ожидали 401/403, получили ${res.status}`)
  })

  it("POST /api/admin/seed без auth → 401/403", async () => {
    const res = await apiCall("POST", "/api/admin/seed")
    assert.ok([401, 403, 409].includes(res.status), `Ожидали 401/403/409, получили ${res.status}`)
  })
})

describe("RBAC — rate limiting на admin auth", () => {
  it("блокируется после 5 попыток → 429", async () => {
    let lastStatus = 200
    for (let i = 0; i < 7; i++) {
      const res = await apiCall("POST", "/api/admin/auth", {
        body: { password: `wrong-${i}-${Date.now()}` },
      })
      lastStatus = res.status
      if (res.status === 429) break
    }
    assert.equal(lastStatus, 429, `Ожидали 429 (rate limit), получили ${lastStatus}`)
  })
})

describe("RBAC — owner полный доступ (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  const endpoints: [string, string][] = [
    ["GET", "/api/clients"],
    ["GET", "/api/payments"],
    ["GET", "/api/expenses"],
    ["GET", "/api/salary-payments"],
  ]

  for (const [method, path] of endpoints) {
    it(`${method} ${path} → 200`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна (seed не применён)"); return }
      const res = await apiCall(method, path, { cookie: ownerCookie })
      assert.equal(res.status, 200, `Ожидали 200, получили ${res.status}`)
    })
  }
})

describe("RBAC — валидация POST (требует seed)", () => {
  const cases: [string, any][] = [
    ["/api/payments", {}],
    ["/api/expenses", {}],
    ["/api/salary-payments", {}],
  ]

  for (const [path, body] of cases) {
    it(`POST ${path} пустое тело → 400`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("POST", path, { cookie: ownerCookie, body })
      assert.equal(res.status, 400, `Ожидали 400, получили ${res.status}`)
    })
  }
})
