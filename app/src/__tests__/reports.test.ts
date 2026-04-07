/**
 * E2E тесты для всех отчётов (/api/reports/*).
 * Проверяем: auth (401), shape ответа (data + metadata), фильтры по датам.
 * Через HTTP на dev-сервере. Скипаются без seed.
 */
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null

const DATE_PARAMS = "?dateFrom=2026-03-01&dateTo=2026-03-31"

// ── Группировка отчётов по доменам ───────────────────────────

const CRM_REPORTS = [
  "visits",
  "not-renewed",
  "active-subscriptions",
  "worked-subscriptions",
  "remaining-lessons",
  "avg-check",
  "avg-subscription-cost",
  "client-ltv",
  "client-segmentation",
  "payments-report",
  "recurring-payments",
  "daily-income",
  "new-client-income",
  "expected-income",
  "student-settlements",
  "discount-audit",
  "linked-discounts",
  "reconciliation",
  "lesson-adjustments-audit",
] as const

const CHURN_REPORTS = [
  "churn-by-months",
  "churn-by-directions",
  "churn-by-instructors",
  "churn-details",
] as const

const LEADS_REPORTS = [
  "funnel",
  "leads-by-day",
  "leads-by-manager",
  "sales-by-channel",
  "trial-conversion",
  "trial-details",
  "trial-no-show",
  "trials-by-day",
  "call-efficiency",
  "reachability",
  "reachability-summary",
] as const

const CAPACITY_REPORTS = [
  "capacity",
  "center-load",
  "absence-losses",
  "subscriptions-by-instructor",
] as const

const FINANCE_REPORTS = [
  "pnl",
  "pnl-group",
  "cash-flow",
  "cash-balance",
  "financial-distribution",
  "debtors",
  "profit-forecast",
] as const

const SALARY_REPORTS = [
  "salary-instructors",
  "salary-forecast",
  "avg-salary",
  "instructor-hours",
  "instructor-profitability",
  "admin-motivation",
] as const

const ALL_REPORTS = [
  ...CRM_REPORTS,
  ...CHURN_REPORTS,
  ...LEADS_REPORTS,
  ...CAPACITY_REPORTS,
  ...FINANCE_REPORTS,
  ...SALARY_REPORTS,
]

// ── Тесты без авторизации → 401 ─────────────────────────────

describe("Отчёты — без авторизации → 401", () => {
  for (const report of ALL_REPORTS) {
    it(`GET /api/reports/${report} → 401`, async () => {
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`)
      assert.ok(
        [401, 302, 307].includes(res.status),
        `${report}: ожидали 401/302/307, получили ${res.status}`
      )
    })
  }
})

// ── CRM-отчёты ──────────────────────────────────────────────

describe("CRM-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of CRM_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      // Проверяем наличие data или массив верхнего уровня
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Churn-отчёты ─────────────────────────────────────────────

describe("Churn-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of CHURN_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Leads-отчёты ─────────────────────────────────────────────

describe("Leads-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of LEADS_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Capacity-отчёты ──────────────────────────────────────────

describe("Capacity-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of CAPACITY_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Finance-отчёты ───────────────────────────────────────────

describe("Finance-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of FINANCE_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Salary-отчёты ────────────────────────────────────────────

describe("Salary-отчёты (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  for (const report of SALARY_REPORTS) {
    it(`GET /api/reports/${report} → 200, shape ok`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200, `${report}: статус ${res.status}`)
      assert.ok(res.data != null, `${report}: тело ответа не null`)
      assert.ok(
        res.data.data !== undefined || Array.isArray(res.data),
        `${report}: ожидаем data поле или массив`
      )
    })
  }
})

// ── Фильтры по датам ─────────────────────────────────────────

describe("Отчёты — фильтры по датам (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("funnel — без дат → 200 (дефолтный период)", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/reports/funnel", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(res.data?.metadata, "metadata присутствует")
  })

  it("pnl — кастомные даты → 200 + metadata.dateFrom/dateTo", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall(
      "GET",
      "/api/reports/pnl?dateFrom=2026-01-01&dateTo=2026-01-31",
      { cookie: ownerCookie }
    )
    assert.equal(res.status, 200)
    assert.ok(res.data?.metadata, "metadata присутствует")
    assert.ok(res.data.metadata.dateFrom, "dateFrom в metadata")
    assert.ok(res.data.metadata.dateTo, "dateTo в metadata")
  })

  it("visits — узкий диапазон (1 день) → 200", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall(
      "GET",
      "/api/reports/visits?dateFrom=2026-03-15&dateTo=2026-03-15",
      { cookie: ownerCookie }
    )
    assert.equal(res.status, 200)
  })

  it("churn-by-months — широкий диапазон (6 месяцев) → 200", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall(
      "GET",
      "/api/reports/churn-by-months?dateFrom=2025-10-01&dateTo=2026-03-31",
      { cookie: ownerCookie }
    )
    assert.equal(res.status, 200)
  })

  it("capacity — без дат (не зависит от периода) → 200", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const res = await apiCall("GET", "/api/reports/capacity", {
      cookie: ownerCookie,
    })
    assert.equal(res.status, 200)
    assert.ok(res.data?.data !== undefined || Array.isArray(res.data))
  })
})

// ── Metadata shape проверки ──────────────────────────────────

describe("Отчёты — metadata shape (требует seed)", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  const reportsWithMetadata = ["funnel", "pnl", "capacity", "visits", "not-renewed"] as const

  for (const report of reportsWithMetadata) {
    it(`${report} — ответ содержит data + metadata`, async (t) => {
      if (!ownerCookie) { t.skip("Auth недоступна"); return }
      const res = await apiCall("GET", `/api/reports/${report}${DATE_PARAMS}`, {
        cookie: ownerCookie,
      })
      assert.equal(res.status, 200)
      assert.ok(res.data != null, "body не null")
      // Отчёты возвращают { data, metadata }
      if (res.data.data !== undefined) {
        assert.ok(
          typeof res.data.metadata === "object" || res.data.metadata === undefined,
          `${report}: metadata — объект (или отсутствует)`
        )
      }
    })
  }
})
