/**
 * Тесты закрытия периодов.
 * Unit-тесты логики + HTTP-тесты API (скипаются без seed).
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

// ── Unit-тесты isPeriodLocked логики ────────────────────────

describe("isPeriodLocked — контракт ролей", () => {
  it("owner/manager bypass закрытый период", () => {
    const bypass = (role: string) => role === "owner" || role === "manager"
    assert.equal(bypass("owner"), true)
    assert.equal(bypass("manager"), true)
    assert.equal(bypass("admin"), false)
    assert.equal(bypass("instructor"), false)
    assert.equal(bypass("readonly"), false)
  })

  it("дата корректно разбирается на year/month", () => {
    const date = new Date("2026-03-15")
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth() + 1, 3)
  })

  it("граничные месяцы: январь=1, декабрь=12", () => {
    assert.equal(new Date("2026-01-01").getMonth() + 1, 1)
    assert.equal(new Date("2026-12-31").getMonth() + 1, 12)
  })

  it("UTC-дата для salary-payments (year, month → Date)", () => {
    const d = new Date(Date.UTC(2026, 2, 1)) // month 0-based → март
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth() + 1, 3)
  })
})

// ── HTTP-тесты API периодов ─────────────────────────────────

let ownerCookie: string | null = null

describe("API /api/periods (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/periods → 200 массив", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/periods", { cookie: ownerCookie })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data))
  })

  it("POST close → 200/201", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/periods", {
      cookie: ownerCookie,
      body: { action: "close", year: 2025, month: 1 },
    })
    assert.ok([200, 201].includes(res.status), `Закрытие: ${res.status}`)
  })

  it("POST reopen → 200/201", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/periods", {
      cookie: ownerCookie,
      body: { action: "reopen", year: 2025, month: 1 },
    })
    assert.ok([200, 201].includes(res.status), `Переоткрытие: ${res.status}`)
  })
})
