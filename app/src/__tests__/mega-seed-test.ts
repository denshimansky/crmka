/**
 * Mega-тест для seed-данных «Умные дети».
 * Проверяет все основные API после seed: auth, dashboard, clients, groups,
 * subscriptions, payments, expenses, reports, backoffice, billing, portal, new modules.
 *
 * Запуск: TEST_BASE_URL=https://dev.umnayacrm.ru npx tsx --test src/__tests__/mega-seed-test.ts
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall, login, DEMO_ACCOUNTS } from "./helpers"

const BASE_URL = process.env.TEST_BASE_URL || "https://dev.umnayacrm.ru"

let ownerCookie: string | null = null

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
describe("Auth", () => {
  it("Login as owner/demo123 → 200", async () => {
    ownerCookie = await login("owner", "demo123")
    assert.ok(ownerCookie, "Owner login should return cookie")
  })

  it("Login as manager/demo123 → 200", async () => {
    const cookie = await login("manager", "demo123")
    assert.ok(cookie, "Manager login should return cookie")
  })

  it("Login as admin/demo123 → 200", async () => {
    const cookie = await login("admin", "demo123")
    assert.ok(cookie, "Admin login should return cookie")
  })

  it("Login as instructor/demo123 → 200", async () => {
    const cookie = await login("instructor", "demo123")
    assert.ok(cookie, "Instructor login should return cookie")
  })

  it("Login wrong password → 401 (null cookie)", async () => {
    const cookie = await login("owner", "wrongpassword")
    assert.equal(cookie, null, "Wrong password should return null")
  })
})

// ═══════════════════════════════════════════════════════════════
// DASHBOARD (server-rendered, no API — test via subscriptions + PnL)
// ═══════════════════════════════════════════════════════════════
describe("Dashboard (via API proxies)", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("Active subscriptions count > 0", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/subscriptions?status=active", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, `Expected active subscriptions > 0, got ${total}`)
  })

  it("Revenue > 0 (via PnL report for March)", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/pnl?dateFrom=2026-03-01&dateTo=2026-03-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const rev = res.data?.revenue ?? res.data?.totalRevenue ?? res.data?.data?.revenue ?? 0
    assert.ok(Number(rev) > 0, `Expected revenue > 0, got ${rev}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// CLIENTS & LEADS
// ═══════════════════════════════════════════════════════════════
describe("Clients & Leads", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/clients → 200, total > 50", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/clients", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 50, `Expected total clients > 50, got ${total}`)
  })

  it("GET /api/clients?status=lead → 200, has items", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/clients?status=lead", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, "Expected at least 1 lead")
  })

  it("GET /api/clients?branchId=X → filters work", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    // First get branches to pick a real ID
    const branchRes = await apiCall("GET", "/api/branches", { cookie: ownerCookie! })
    const branches = Array.isArray(branchRes.data) ? branchRes.data : branchRes.data?.items ?? []
    if (branches.length > 0) {
      const branchId = branches[0].id
      const res = await apiCall("GET", `/api/clients?branchId=${branchId}`, {
        cookie: ownerCookie!,
      })
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// GROUPS & SCHEDULE
// ═══════════════════════════════════════════════════════════════
describe("Groups & Schedule", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/groups → 200, count >= 18", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/groups", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    assert.ok(items.length >= 18, `Expected >= 18 groups, got ${items.length}`)
  })

  it("Lessons exist (via visits report for March 2026)", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/visits?dateFrom=2026-03-01&dateTo=2026-03-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    // Visits report should have data if lessons exist
    assert.ok(res.data, "Expected visits data for March")
  })
})

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════
describe("Subscriptions", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/subscriptions → 200, count > 0", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/subscriptions", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, `Expected subscriptions > 0, got ${total}`)
  })

  it("GET /api/subscriptions?status=active → has items", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/subscriptions?status=active", {
      cookie: ownerCookie!,
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, `Expected active subscriptions > 0, got ${total}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════
describe("Payments", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/payments → 200, has items", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/payments", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, `Expected payments > 0, got ${total}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════
describe("Expenses", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/expenses → 200, has items", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/expenses", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total > 0, `Expected expenses > 0, got ${total}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════
describe("Reports", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/reports/funnel → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/reports/funnel", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/pnl?dateFrom=2026-01-01&dateTo=2026-03-31 → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/pnl?dateFrom=2026-01-01&dateTo=2026-03-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/visits?dateFrom=2026-01-01&dateTo=2026-01-31 → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/visits?dateFrom=2026-01-01&dateTo=2026-01-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/churn-details?dateFrom=2026-01-01&dateTo=2026-03-31 → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/churn-details?dateFrom=2026-01-01&dateTo=2026-03-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/capacity → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/reports/capacity", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/salary-instructors?dateFrom=2026-01-01&dateTo=2026-01-31 → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall(
      "GET",
      "/api/reports/salary-instructors?dateFrom=2026-01-01&dateTo=2026-01-31",
      { cookie: ownerCookie! }
    )
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/debtors → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/reports/debtors", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/reports/active-subscriptions → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/reports/active-subscriptions", {
      cookie: ownerCookie!,
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// BACKOFFICE
// ═══════════════════════════════════════════════════════════════
describe("Backoffice", () => {
  let adminCookie: string | null = null

  it("Login as superadmin → 200", async () => {
    // Admin auth sets an httpOnly cookie "admin-token"
    const url = `${BASE_URL}/api/admin/auth`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@umnayacrm.ru", password: "admin123" }),
      redirect: "manual",
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const cookies = res.headers.getSetCookie()
    adminCookie = cookies.map((c) => c.split(";")[0]).join("; ")
    assert.ok(adminCookie.includes("admin-token"), "Should set admin-token cookie")
  })

  it("GET /api/admin/partners → 200, has at least 1 partner", async () => {
    assert.ok(adminCookie, "Need admin auth cookie")
    const res = await apiCall("GET", "/api/admin/partners", {
      cookie: adminCookie!,
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    assert.ok(items.length >= 1, `Expected >= 1 partner, got ${items.length}`)
  })

  it("GET /api/admin/invoices → 200, has invoices", async () => {
    assert.ok(adminCookie, "Need admin auth cookie")
    const res = await apiCall("GET", "/api/admin/invoices", {
      cookie: adminCookie!,
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    assert.ok(items.length > 0, `Expected invoices > 0, got ${items.length}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// BILLING (owner)
// ═══════════════════════════════════════════════════════════════
describe("Billing (owner)", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/billing → 200, has subscription info", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/billing", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    assert.ok(res.data, "Expected subscription/billing data")
  })
})

// ═══════════════════════════════════════════════════════════════
// PORTAL
// ═══════════════════════════════════════════════════════════════
describe("Portal", () => {
  it("GET /api/portal/data → responds (401 without token)", async () => {
    // Portal requires portal token; without it should return 401
    const res = await apiCall("GET", "/api/portal/data")
    assert.ok([200, 401, 403].includes(res.status), `Expected 200/401/403, got ${res.status}`)
  })

  it("GET /api/portal/auth → responds", async () => {
    const res = await apiCall("GET", "/api/portal/auth")
    assert.ok([200, 401, 403, 405].includes(res.status), `Expected valid response, got ${res.status}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// NEW MODULES
// ═══════════════════════════════════════════════════════════════
describe("New modules", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("GET /api/notifications → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/notifications", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/production-calendar?year=2026 → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/production-calendar?year=2026", {
      cookie: ownerCookie!,
    })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/discount-templates → 200", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/discount-templates", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })

  it("GET /api/audit → 200 (owner only)", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/audit", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  })
})

// ═══════════════════════════════════════════════════════════════
// DATA INTEGRITY CHECKS
// ═══════════════════════════════════════════════════════════════
describe("Data integrity", () => {
  before(async () => {
    if (!ownerCookie) ownerCookie = await getAuthCookie("owner")
  })

  it("Revenue January < February < March (growing)", async () => {
    assert.ok(ownerCookie, "Need owner auth")

    const months = [
      { from: "2026-01-01", to: "2026-01-31", label: "Jan" },
      { from: "2026-02-01", to: "2026-02-28", label: "Feb" },
      { from: "2026-03-01", to: "2026-03-31", label: "Mar" },
    ]

    const revenues: number[] = []
    for (const m of months) {
      const res = await apiCall(
        "GET",
        `/api/reports/pnl?dateFrom=${m.from}&dateTo=${m.to}`,
        { cookie: ownerCookie! }
      )
      if (res.status === 200 && res.data) {
        const rev =
          res.data?.revenue ?? res.data?.totalRevenue ?? res.data?.data?.revenue ?? 0
        revenues.push(Number(rev))
      } else {
        revenues.push(0)
      }
    }

    assert.ok(
      revenues[0] < revenues[1],
      `Expected Jan (${revenues[0]}) < Feb (${revenues[1]})`
    )
    assert.ok(
      revenues[1] < revenues[2],
      `Expected Feb (${revenues[1]}) < Mar (${revenues[2]})`
    )
  })

  it("Total active subscriptions in March >= 100", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/subscriptions?status=active", {
      cookie: ownerCookie!,
    })
    assert.equal(res.status, 200)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    const total = res.data?.total ?? res.data?.pagination?.total ?? items.length
    assert.ok(total >= 100, `Expected >= 100 active subs, got ${total}`)
  })

  it("At least 2 branches in /api/branches", async () => {
    assert.ok(ownerCookie, "Need owner auth")
    const res = await apiCall("GET", "/api/branches", { cookie: ownerCookie! })
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
    const items = Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.data ?? []
    assert.ok(items.length >= 2, `Expected >= 2 branches, got ${items.length}`)
  })
})
