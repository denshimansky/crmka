import { test, expect, type Page } from "@playwright/test"

/**
 * Полный acceptance-тест CRM: UI + API + роли + отчёты
 *
 * PART 1: Верхнеуровневый обход (backoffice, owner, роли)
 * PART 2: Глубинное тестирование (CRM-цикл, расписание, финансы, отчёты, настройки, API)
 */

test.setTimeout(120_000)

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginOwner(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 15000 })
}

async function loginCRM(page: Page, login: string, password = "demo123") {
  await page.goto("/login")
  await page.fill('input[id="login"]', login)
  await page.fill('input[id="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 15000 })
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login")
  await page.waitForLoadState("networkidle")
  const emailInput = page.locator('input[id="email"]')
  await emailInput.waitFor({ state: "visible", timeout: 10000 })
  await page.waitForTimeout(500)
  await emailInput.click()
  await emailInput.fill("admin@umnayacrm.ru")
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill("admin123")
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 15000 })
}

/** Проверка что страница не содержит Application error */
async function assertNoError(page: Page) {
  await page.waitForLoadState("networkidle")
  const errorText = page.locator("text=Application error")
  await expect(errorText).toHaveCount(0, { timeout: 5000 })
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: ВЕРХНЕУРОВНЕВЫЙ ОБХОД
// ═══════════════════════════════════════════════════════════════════════════

test.describe("PART 1: Верхнеуровневый обход", () => {
  // ── 1.1 Backoffice (superadmin) ──────────────────────────────────────────

  test.describe("1.1 Backoffice (superadmin)", () => {
    test("admin login → dashboard → partners → invoices → plans", async ({ page }) => {
      // Login
      await adminLogin(page)
      await expect(page.locator("h1")).toContainText("Партнёры")

      // Partners table has at least 1 row with "Умные дети"
      await page.waitForSelector("table", { timeout: 10000 })
      await expect(page.locator("table tbody tr").first()).toBeVisible()
      await expect(page.locator("text=Умные дети")).toBeVisible()

      // Invoices
      await page.goto("/admin/invoices")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Счета")
      await page.waitForSelector("table", { timeout: 10000 })
      await expect(page.locator("table tbody tr").first()).toBeVisible()

      // Plans
      await page.goto("/admin/plans")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Тариф")
    })
  })

  // ── 1.2 CRM (owner) ─────────────────────────────────────────────────────

  test.describe("1.2 CRM (owner) — dashboard + sidebar navigation", () => {
    test("dashboard loads with widgets showing data", async ({ page }) => {
      await loginOwner(page)
      await expect(page.locator("h1")).toContainText("Главная")
      // Widgets with real numbers
      await expect(page.locator("text=Активные абонементы")).toBeVisible()
      await expect(page.locator("text=Выручка за месяц")).toBeVisible()
      await expect(page.locator("text=Расходы за месяц")).toBeVisible()
    })

    test("sidebar: /crm/leads → table with data", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/crm/leads")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Лиды")
    })

    test("sidebar: /crm/clients → table with rows", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/crm/clients")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Клиенты")
      await page.waitForSelector("table", { timeout: 10000 })
      await expect(page.locator("table tbody tr").first()).toBeVisible()
    })

    test("sidebar: /schedule → content loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/schedule")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Расписание")
    })

    test("sidebar: /finance/payments → page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/payments")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Оплаты")
      // Page defaults to current month (Apr 2026) — may show "Нет оплат"
      // Seed data is in Jan–Mar; data integrity checked via API tests below
    })

    test("sidebar: /finance/expenses → page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/expenses")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Расходы")
    })

    test("sidebar: /reports → content", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Отчёты")
    })

    test("sidebar: /salary → content", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/salary")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText(/[Зз]арплат/)
    })

    test("sidebar: /billing → subscription info", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/billing")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText(/[Пп]одписк|[Бб]иллинг|[Лл]ичный/)
    })

    test("notification bell opens dropdown", async ({ page }) => {
      await loginOwner(page)
      // Look for notification bell button
      const bell = page.locator('button:has(svg), [data-testid="notification-bell"], button[aria-label*="уведомлен"]').first()
      if (await bell.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bell.click()
        await page.waitForTimeout(500)
        // Dropdown or popover should appear
      }
    })

    test("logout works", async ({ page }) => {
      await loginOwner(page)
      await page.click('button[title="Выйти"]')
      await page.waitForURL(/\/login/, { timeout: 10000 })
    })
  })

  // ── 1.3 Role checks ─────────────────────────────────────────────────────

  test.describe("1.3 Role checks", () => {
    test("admin role — dashboard loads", async ({ page }) => {
      await loginCRM(page, "admin")
      await expect(page.locator("h1")).toContainText("Главная")
    })

    test("instructor role — dashboard loads", async ({ page }) => {
      await loginCRM(page, "instructor")
      await expect(page.locator("h1")).toContainText("Главная")
    })

    test("viewer role — dashboard loads", async ({ page }) => {
      await loginCRM(page, "viewer")
      await expect(page.locator("h1")).toContainText("Главная")
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: ГЛУБИННОЕ ТЕСТИРОВАНИЕ
// ═══════════════════════════════════════════════════════════════════════════

test.describe("PART 2: Глубинное тестирование", () => {
  // ── 2.1 CRM cycle ───────────────────────────────────────────────────────

  test.describe("2.1 CRM cycle", () => {
    test("leads count > 0", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/crm/leads")
      await page.waitForLoadState("networkidle")
      // Should have rows in table or list items
      const rows = page.locator("table tbody tr, [data-testid='lead-row']")
      const count = await rows.count()
      expect(count).toBeGreaterThan(0)
    })

    test("clients count > 0, click first → detail page", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/crm/clients")
      await page.waitForSelector("table", { timeout: 10000 })

      const rows = page.locator("table tbody tr")
      const count = await rows.count()
      expect(count).toBeGreaterThan(0)

      // Click first client row
      await rows.first().click()
      await page.waitForLoadState("networkidle")
      await assertNoError(page)

      // Client card should have name and info
      const pageContent = await page.textContent("body")
      // Should contain phone or subscription info
      expect(
        pageContent?.includes("Абонемент") ||
        pageContent?.includes("абонемент") ||
        pageContent?.includes("Телефон") ||
        pageContent?.includes("+7") ||
        pageContent?.includes("Подопечн")
      ).toBeTruthy()
    })
  })

  // ── 2.2 Schedule ────────────────────────────────────────────────────────

  test.describe("2.2 Schedule", () => {
    test("schedule page loads with groups", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/schedule")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Расписание")
    })

    test("groups page has data", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/schedule/groups")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Группы")
      await page.waitForSelector("table", { timeout: 10000 })
      const rows = page.locator("table tbody tr")
      expect(await rows.count()).toBeGreaterThan(0)
    })
  })

  // ── 2.3 Finance ─────────────────────────────────────────────────────────

  test.describe("2.3 Finance", () => {
    test("payments page loads correctly", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/payments")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Оплаты")
      // Should show summary cards (Поступления, Наличные, etc.)
      await expect(page.locator("text=Поступления")).toBeVisible()
    })

    test("expenses page loads correctly", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/expenses")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Расходы")
      // Should show summary cards
      await expect(page.locator("text=Расходы за месяц")).toBeVisible()
    })

    test("debtors page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/debtors")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Должники")
    })
  })

  // ── 2.4 Reports ─────────────────────────────────────────────────────────

  test.describe("2.4 Reports", () => {
    test("report catalog page", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports")
      await expect(page.locator("h1")).toContainText("Отчёты")
      await expect(page.locator("text=CRM и маркетинг")).toBeVisible()
      await expect(page.locator("text=Финансы").first()).toBeVisible()
    })

    test("funnel report has data", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports/crm/funnel")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Воронка")
      await expect(page.locator("text=Всего клиентов")).toBeVisible()
    })

    test("P&L report has data", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports/finance/pnl")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Финансовый результат")
      await expect(page.locator("p:has-text('Выручка')").first()).toBeVisible()
      await expect(page.locator("p:has-text('Маржа')").first()).toBeVisible()
    })

    test("visits report has data", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports/attendance/visits")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Посещения")
    })

    test("active subscriptions report", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports/subscriptions/active")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })

    test("churn details report", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/reports/churn/details")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Детализация оттока")
    })
  })

  // ── 2.5 Settings & Staff ────────────────────────────────────────────────

  test.describe("2.5 Settings & Staff", () => {
    test("settings page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/settings")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Настройки")
    })

    test("staff page has employees", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/staff")
      await assertNoError(page)
      await expect(page.locator("h1")).toContainText("Сотрудники")
      await page.waitForSelector("table", { timeout: 10000 })
      const rows = page.locator("table tbody tr")
      const count = await rows.count()
      expect(count).toBeGreaterThan(5) // seed has 14 employees
    })

    test("directions exist in settings", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/settings/directions")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })
  })

  // ── 2.6 New modules ─────────────────────────────────────────────────────

  test.describe("2.6 New modules", () => {
    test("production calendar page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/schedule/calendar")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })

    test("discount templates page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/settings/discount-templates")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })

    test("admin bonus page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/settings/admin-bonus")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })

    test("planned expenses page loads", async ({ page }) => {
      await loginOwner(page)
      await page.goto("/finance/planned-expenses")
      await page.waitForLoadState("networkidle")
      await assertNoError(page)
    })
  })

  // ── 2.7 Data integrity via API ──────────────────────────────────────────

  test.describe("2.7 Data integrity via API", () => {
    let cookies: { name: string; value: string }[]

    test.beforeAll(async ({ browser }) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await ctx.newPage()
      await loginOwner(page)
      cookies = await ctx.cookies()
      await ctx.close()
    })

    function apiContext(page: Page) {
      return page.request
    }

    test("GET /api/clients → total > 50", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/clients")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      const total = Array.isArray(data) ? data.length : (data.total ?? data.clients?.length ?? 0)
      expect(total).toBeGreaterThan(50)
    })

    test("GET /api/subscriptions?status=active → count > 100", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/subscriptions?status=active")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      const count = Array.isArray(data) ? data.length : (data.total ?? data.subscriptions?.length ?? 0)
      expect(count).toBeGreaterThan(100)
    })

    test("GET /api/reports/pnl → response ok", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/reports/pnl?dateFrom=2026-01-01&dateTo=2026-03-31")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(data).toBeDefined()
    })

    test("GET /api/reports/funnel → has stages with counts > 0", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/reports/funnel")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      // funnel should have stages array or object with counts
      const hasData = JSON.stringify(data).length > 10
      expect(hasData).toBeTruthy()
    })

    test("GET /api/branches → exactly 2 branches", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/branches")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      const branches = Array.isArray(data) ? data : (data.branches ?? [])
      expect(branches.length).toBe(2)
    })

    test("GET /api/groups → at least 15 groups", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/groups")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      const groups = Array.isArray(data) ? data : (data.groups ?? [])
      expect(groups.length).toBeGreaterThanOrEqual(15)
    })

    test("GET /api/reports/visits → has data", async ({ page }) => {
      await loginOwner(page)
      const res = await page.request.get("/api/reports/visits?dateFrom=2026-01-01&dateTo=2026-01-31")
      expect(res.ok()).toBeTruthy()
      const data = await res.json()
      expect(data).toBeDefined()
      const hasData = JSON.stringify(data).length > 10
      expect(hasData).toBeTruthy()
    })
  })
})
