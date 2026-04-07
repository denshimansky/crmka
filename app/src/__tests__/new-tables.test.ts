/**
 * E2E тесты CRUD для новых MVP-таблиц.
 * ProductionCalendar, DiscountTemplate — полные API.
 * PlannedExpense, AdminBonusSettings, Notification, UnprolongedComment — каталоги (пустые route).
 * Через HTTP на dev-сервере. Скипаются без seed.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall, uuid } from "./helpers"

let ownerCookie: string | null = null
let instructorCookie: string | null = null
let readonlyCookie: string | null = null

// ── ProductionCalendar ───────────────────────────────────────

describe("ProductionCalendar — без авторизации", () => {
  it("GET /api/production-calendar → 401", async () => {
    const res = await apiCall("GET", "/api/production-calendar")
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`
    )
  })

  it("POST /api/production-calendar → 401", async () => {
    const res = await apiCall("POST", "/api/production-calendar", {
      body: { date: "2026-05-01", isWorking: false },
    })
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`
    )
  })
})

describe("ProductionCalendar — CRUD (требует seed)", () => {
  let createdId: string | null = null
  const testDate = "2026-12-25"

  before(async () => {
    ownerCookie = await getAuthCookie("owner")
    instructorCookie = await getAuthCookie("instructor")
    readonlyCookie = await getAuthCookie("readonly")
  })

  it("GET /api/production-calendar → 200 массив", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/production-calendar?year=2026", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data), "Ответ — массив")
  })

  it("POST → 201 (создание записи)", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/production-calendar", {
      cookie: ownerCookie,
      body: { date: testDate, isWorking: false, comment: "E2E тест" },
    })
    assert.ok([200, 201].includes(res.status), `Создание: статус ${res.status}`)
    assert.ok(res.data?.id, "Есть id в ответе")
    createdId = res.data.id
  })

  it("GET по year+month → фильтрация работает", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/production-calendar?year=2026&month=12", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data))
  })

  it("GET /:id → 200", async (t) => {
    if (!ownerCookie || !createdId) { t.skip("Auth недоступна или нет записи"); return }
    const res = await apiCall("GET", `/api/production-calendar/${createdId}`, {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.equal(res.data.id, createdId)
  })

  it("PUT /:id → 200 (обновление)", async (t) => {
    if (!ownerCookie || !createdId) { t.skip("Auth недоступна или нет записи"); return }
    const res = await apiCall("PUT", `/api/production-calendar/${createdId}`, {
      cookie: ownerCookie,
      body: { isWorking: true, comment: "E2E обновлён" },
    })
    assert.equal(res.status, 200)
  })

  it("DELETE /:id → 200", async (t) => {
    if (!ownerCookie || !createdId) { t.skip("Auth недоступна или нет записи"); return }
    const res = await apiCall("DELETE", `/api/production-calendar/${createdId}`, {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
  })

  it("GET /:id после удаления → 404", async (t) => {
    if (!ownerCookie || !createdId) { t.skip("Auth недоступна или нет записи"); return }
    const res = await apiCall("GET", `/api/production-calendar/${createdId}`, {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 404)
  })

  it("POST от instructor → 403", async (t) => {
    if (!instructorCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/production-calendar", {
      cookie: instructorCookie,
      body: { date: "2026-12-31", isWorking: false },
    })
    assert.equal(res.status, 403, `Ожидали 403, получили ${res.status}`)
  })

  it("POST от readonly → 403", async (t) => {
    if (!readonlyCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/production-calendar", {
      cookie: readonlyCookie,
      body: { date: "2026-12-31", isWorking: false },
    })
    assert.equal(res.status, 403, `Ожидали 403, получили ${res.status}`)
  })

  it("POST без date → 400", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/production-calendar", {
      cookie: ownerCookie,
      body: { isWorking: true },
    })
    assert.equal(res.status, 400)
  })
})

// ── DiscountTemplate ─────────────────────────────────────────

describe("DiscountTemplate — без авторизации", () => {
  it("GET /api/discount-templates → 401", async () => {
    const res = await apiCall("GET", "/api/discount-templates")
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`
    )
  })

  it("POST /api/discount-templates → 401", async () => {
    const res = await apiCall("POST", "/api/discount-templates", {
      body: { name: "test", type: "permanent", valueType: "percent", value: 10 },
    })
    assert.ok(
      [401, 302, 307].includes(res.status),
      `Ожидали 401/302/307, получили ${res.status}`
    )
  })
})

describe("DiscountTemplate — CRUD (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
    instructorCookie = await getAuthCookie("instructor")
  })

  it("GET /api/discount-templates → 200 массив", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/discount-templates", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data), "Ответ — массив")
  })

  it("POST → 201 (создание шаблона скидки)", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/discount-templates", {
      cookie: ownerCookie,
      body: {
        name: `E2E тест ${Date.now()}`,
        type: "permanent",
        valueType: "percent",
        value: 15,
        isStackable: false,
        isActive: true,
      },
    })
    assert.ok([200, 201].includes(res.status), `Создание: статус ${res.status}`)
    assert.ok(res.data?.id, "Есть id в ответе")
    assert.equal(res.data.value, 15)
  })

  it("GET с фильтром isActive=true → 200", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/discount-templates?isActive=true", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data))
    // Все записи должны быть активными
    for (const item of res.data) {
      assert.equal(item.isActive, true, "isActive = true для всех записей")
    }
  })

  it("GET с фильтром type=permanent → 200", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/discount-templates?type=permanent", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data))
    for (const item of res.data) {
      assert.equal(item.type, "permanent")
    }
  })

  it("POST от instructor → 403", async (t) => {
    if (!instructorCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/discount-templates", {
      cookie: instructorCookie,
      body: {
        name: "Instructor test",
        type: "one_time",
        valueType: "fixed",
        value: 500,
      },
    })
    assert.equal(res.status, 403, `Ожидали 403, получили ${res.status}`)
  })

  it("POST без name → 400", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/discount-templates", {
      cookie: ownerCookie,
      body: { type: "permanent", valueType: "percent", value: 10 },
    })
    assert.equal(res.status, 400)
  })

  it("POST отрицательное value → 400", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/discount-templates", {
      cookie: ownerCookie,
      body: { name: "Negative", type: "permanent", valueType: "percent", value: -5 },
    })
    assert.equal(res.status, 400)
  })
})

// ── PlannedExpense — проверка наличия endpoint ───────────────

describe("PlannedExpense (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/planned-expenses без auth → 401/302/307/404", async () => {
    const res = await apiCall("GET", "/api/planned-expenses")
    assert.ok(
      [401, 302, 307, 404].includes(res.status),
      `Ожидали 401/302/307/404, получили ${res.status}`
    )
  })

  it("GET /api/planned-expenses с auth → 200/404 (эндпоинт может быть не реализован)", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/planned-expenses", {
      cookie: ownerCookie,
    })
    // 200 если реализован, 404 если пока нет route.ts
    assert.ok(
      [200, 404].includes(res.status),
      `Ожидали 200/404, получили ${res.status}`
    )
  })
})

// ── AdminBonusSettings — проверка наличия endpoint ───────────

describe("AdminBonusSettings (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/admin-bonus-settings без auth → 401/302/307/404", async () => {
    const res = await apiCall("GET", "/api/admin-bonus-settings")
    assert.ok(
      [401, 302, 307, 404].includes(res.status),
      `Ожидали 401/302/307/404, получили ${res.status}`
    )
  })

  it("GET /api/admin-bonus-settings с auth → 200/404", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/admin-bonus-settings", {
      cookie: ownerCookie,
    })
    assert.ok(
      [200, 404].includes(res.status),
      `Ожидали 200/404, получили ${res.status}`
    )
  })
})

// ── Notification ─────────────────────────────────────────────

describe("Notification (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/notifications без auth → 401/302/307/404", async () => {
    const res = await apiCall("GET", "/api/notifications")
    assert.ok(
      [401, 302, 307, 404].includes(res.status),
      `Ожидали 401/302/307/404, получили ${res.status}`
    )
  })

  it("GET /api/notifications с auth → 200/404", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/notifications", {
      cookie: ownerCookie,
    })
    assert.ok(
      [200, 404].includes(res.status),
      `Ожидали 200/404, получили ${res.status}`
    )
    // Если реализован — проверяем shape
    if (res.status === 200) {
      assert.ok(
        Array.isArray(res.data) || res.data?.data !== undefined,
        "Ответ — массив или объект с data"
      )
    }
  })

  it("PATCH /api/notifications/:id (mark read) без auth → 401/302/307/404/405", async () => {
    const fakeId = uuid()
    const res = await apiCall("PATCH", `/api/notifications/${fakeId}`, {
      body: { isRead: true },
    })
    assert.ok(
      [401, 302, 307, 404, 405].includes(res.status),
      `Ожидали 401/302/307/404/405, получили ${res.status}`
    )
  })
})

// ── UnprolongedComment ───────────────────────────────────────

describe("UnprolongedComment (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/unprolonged-comments без auth → 401/302/307/404", async () => {
    const res = await apiCall("GET", "/api/unprolonged-comments")
    assert.ok(
      [401, 302, 307, 404].includes(res.status),
      `Ожидали 401/302/307/404, получили ${res.status}`
    )
  })

  it("GET /api/unprolonged-comments с auth → 200/404", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/unprolonged-comments", {
      cookie: ownerCookie,
    })
    assert.ok(
      [200, 404].includes(res.status),
      `Ожидали 200/404, получили ${res.status}`
    )
  })

  it("POST /api/unprolonged-comments без auth → 401/302/307/404", async () => {
    const res = await apiCall("POST", "/api/unprolonged-comments", {
      body: { clientId: uuid(), comment: "E2E тест" },
    })
    assert.ok(
      [401, 302, 307, 404].includes(res.status),
      `Ожидали 401/302/307/404, получили ${res.status}`
    )
  })

  it("POST /api/unprolonged-comments с auth → 201/200/400/404", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("POST", "/api/unprolonged-comments", {
      cookie: ownerCookie,
      body: { clientId: uuid(), comment: "E2E тест непродлёнки" },
    })
    // 201/200 если работает, 400 если нет clientId, 404 если route не реализован
    assert.ok(
      [200, 201, 400, 404].includes(res.status),
      `Ожидали 200/201/400/404, получили ${res.status}`
    )
  })
})
