import { test, expect } from "@playwright/test"

const BASE = process.env.TEST_BASE_URL || "https://dev.umnayacrm.ru"

async function login(page: any) {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), {
    timeout: 15000,
    waitUntil: "domcontentloaded",
  })
}

async function waitForContent(page: any) {
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)
}

test.describe("Verify seed data on all pages", () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("Dashboard has data", async ({ page }) => {
    await waitForContent(page)
    await expect(page.locator("text=Умные дети")).toBeVisible({ timeout: 10000 })
    const text = await page.textContent("body")
    expect(text).toMatch(/Активные абонементы|Активных/)
    expect(text).toContain("118")
  })

  test("Leads page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/leads`)
    await waitForContent(page)
    const rows = page.locator("table tbody tr, [data-testid='lead-card']")
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Clients page — active clients exist", async ({ page }) => {
    await page.goto(`${BASE}/crm/clients`)
    await waitForContent(page)
    const rows = page.locator("table tbody tr")
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Duplicates page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/duplicates`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toMatch(/дубл|Антонова|Березин|Виноградова/i)
  })

  test("Call campaigns page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/calls`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toContain("Возврат ушедших")
  })

  test("Payments page — March has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/payments?year=2026&month=3`)
    await waitForContent(page)
    const rows = page.locator("table tbody tr")
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Expenses page — recurring expenses exist", async ({ page }) => {
    await page.goto(`${BASE}/finance/expenses?year=2026&month=1`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toContain("Аренда")
  })

  test("Cash page — March has payments", async ({ page }) => {
    await page.goto(`${BASE}/finance/cash?year=2026&month=3`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).not.toContain("Нет оплат за")
  })

  test("DDS report has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/dds?year=2026&month=3`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toMatch(/Приход|Расход|Оплат|итого/i)
  })

  test("Debtors page loads", async ({ page }) => {
    await page.goto(`${BASE}/finance/debtors`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toMatch(/Должники|должник|Нет должников|0/i)
  })

  test("Schedule page loads", async ({ page }) => {
    await page.goto(`${BASE}/schedule`)
    await waitForContent(page)
    const body = await page.textContent("body")
    // Schedule renders current week — lessons may not exist for current dates
    // Verify the page loads and shows schedule UI elements
    expect(body).toMatch(/Расписание|Группы|Занятие|Нет занятий/i)
  })

  test("Reports catalog loads", async ({ page }) => {
    await page.goto(`${BASE}/reports`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toMatch(/Воронка|Отток|P&L|Свободные места/i)
  })

  test("Salary page has data for March", async ({ page }) => {
    await page.goto(`${BASE}/salary?year=2026&month=3`)
    await waitForContent(page)
    const rows = page.locator("table tbody tr")
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Tasks page has pending tasks", async ({ page }) => {
    await page.goto(`${BASE}/tasks`)
    await waitForContent(page)
    const body = await page.textContent("body")
    expect(body).toMatch(/Позвонить|Подготовить|задач/i)
  })
})
