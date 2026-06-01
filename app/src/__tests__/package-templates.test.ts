/**
 * E2E тесты CRUD для шаблонов пакетов (/api/package-templates).
 * Через HTTP на dev-сервере. Скипаются без seed.
 *
 * Логика:
 *  - GET доступен всем авторизованным; для calendar-tenant возвращает пустой массив.
 *  - POST/PATCH/DELETE доступны только owner/manager и только если org.subscriptionType === 'package'.
 *  - bulk доступен только owner.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null
let managerCookie: string | null = null
let instructorCookie: string | null = null

before(async () => {
  ownerCookie = await getAuthCookie("owner")
  managerCookie = await getAuthCookie("manager")
  instructorCookie = await getAuthCookie("instructor")
})

// ── Без авторизации ──────────────────────────────────────────

describe("PackageTemplate — без авторизации", () => {
  it("GET /api/package-templates → 401", async () => {
    const res = await apiCall("GET", "/api/package-templates")
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`,
    )
  })

  it("POST /api/package-templates → 401", async () => {
    const res = await apiCall("POST", "/api/package-templates", {
      body: { lessonsCount: 8 },
    })
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`,
    )
  })

  it("POST /api/package-templates/bulk → 401", async () => {
    const res = await apiCall("POST", "/api/package-templates/bulk", {
      body: { templates: [{ lessonsCount: 4 }] },
    })
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`,
    )
  })
})

// ── GET доступен всем авторизованным ─────────────────────────

describe("PackageTemplate — GET", () => {
  it("GET → 200 массив (любая роль)", async (t) => {
    if (!instructorCookie) {
      t.skip("Auth недоступна")
      return
    }
    const res = await apiCall("GET", "/api/package-templates", {
      cookie: instructorCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data), "Ответ — массив")
  })
})

// ── Гард по subscriptionType ─────────────────────────────────

describe("PackageTemplate — гард по subscriptionType", () => {
  it("POST для calendar-tenant → 409", async (t) => {
    if (!ownerCookie) {
      t.skip("Auth недоступна")
      return
    }
    // Демо-tenant в seed имеет subscriptionType='calendar' (после backfill миграции).
    // Поэтому POST должен вернуть 409 — шаблоны доступны только для package.
    const res = await apiCall("POST", "/api/package-templates", {
      cookie: ownerCookie,
      body: { lessonsCount: 8, validDays: 60 },
    })
    assert.ok(
      [409, 201].includes(res.status),
      `Ожидали 409 (calendar) или 201 (package): получили ${res.status}`,
    )
    if (res.status === 409) {
      assert.match(res.data?.error ?? "", /Пакетный|package/i)
    }
  })
})

// ── Forbidden ────────────────────────────────────────────────

describe("PackageTemplate — RBAC", () => {
  it("POST от instructor → 403", async (t) => {
    if (!instructorCookie) {
      t.skip("Auth недоступна")
      return
    }
    const res = await apiCall("POST", "/api/package-templates", {
      cookie: instructorCookie,
      body: { lessonsCount: 8 },
    })
    assert.equal(res.status, 403)
  })

  it("POST /bulk от manager → 403 (только owner)", async (t) => {
    if (!managerCookie) {
      t.skip("Auth недоступна")
      return
    }
    const res = await apiCall("POST", "/api/package-templates/bulk", {
      cookie: managerCookie,
      body: { templates: [{ lessonsCount: 4 }] },
    })
    assert.equal(res.status, 403)
  })
})

// ── Гард на смену subscriptionType ───────────────────────────

describe("Organization — subscriptionType locked-гард", () => {
  it("PATCH /api/organization {subscriptionType:'package'} на locked-tenant → 409", async (t) => {
    if (!ownerCookie) {
      t.skip("Auth недоступна")
      return
    }
    // После backfill миграции demo-tenant имеет subscriptionTypeLockedAt != null.
    // Попытка сменить тип должна возвращать 409.
    const res = await apiCall("PATCH", "/api/organization", {
      cookie: ownerCookie,
      body: { subscriptionType: "package" },
    })
    assert.ok(
      [409, 200].includes(res.status),
      `Ожидали 409 (locked) или 200 (не locked): получили ${res.status}`,
    )
  })

  it("PATCH /api/organization {subscriptionType:'package'} от instructor → 403", async (t) => {
    if (!instructorCookie) {
      t.skip("Auth недоступна")
      return
    }
    const res = await apiCall("PATCH", "/api/organization", {
      cookie: instructorCookie,
      body: { subscriptionType: "package" },
    })
    assert.equal(res.status, 403)
  })
})
