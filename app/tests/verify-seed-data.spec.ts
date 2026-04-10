import { test, expect } from "@playwright/test"

const BASE = "https://dev.umnayacrm.ru"

test.describe("Verify seed data on all pages", () => {
  test.beforeEach(async ({ page }) => {
    // Login as owner
    await page.goto(`${BASE}/login`)
    await page.fill('input[name="login"]', "owner")
    await page.fill('input[name="password"]', "demo123")
    await page.click('button[type="submit"]')
    await page.waitForURL("**/dashboard**", { timeout: 10000 })
  })

  test("Dashboard has data", async ({ page }) => {
    await expect(page.locator("text=Умные дети")).toBeVisible({ timeout: 5000 })
    // Should have widgets with non-zero numbers
    const text = await page.textContent("body")
    expect(text).toContain("Активных")
  })

  test("Leads page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/leads`)
    await page.waitForLoadState("networkidle")
    // Should have lead entries — look for table rows or cards
    const rows = page.locator("table tbody tr, [data-testid='lead-card']")
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Clients page — active clients exist", async ({ page }) => {
    await page.goto(`${BASE}/crm/clients`)
    await page.waitForLoadState("networkidle")
    const rows = page.locator("table tbody tr")
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Clients page — churned filter works", async ({ page }) => {
    await page.goto(`${BASE}/crm/clients?status=churned`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should have churned clients (выбывшие)
    expect(body).toMatch(/выб|churned|Антонова|Березин|Голубев|Давыдова|Ефремов/i)
  })

  test("Duplicates page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/duplicates`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should show duplicate groups
    expect(body).toMatch(/дубл|Антонова|Березин|Виноградова/i)
  })

  test("Call campaigns page has data", async ({ page }) => {
    await page.goto(`${BASE}/crm/calls`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should have at least 1 campaign
    expect(body).toContain("Возврат ушедших")
  })

  test("Payments page — April has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/payments?year=2026&month=4`)
    await page.waitForLoadState("networkidle")
    const rows = page.locator("table tbody tr")
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Expenses page — recurring expenses exist", async ({ page }) => {
    await page.goto(`${BASE}/finance/expenses?year=2026&month=1`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    expect(body).toContain("Аренда")
  })

  test("Planned expenses page has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/planned-expenses?year=2026&month=4`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should have planned expenses
    expect(body).toMatch(/Аренда|Маркетинг|90.*000|15.*000/)
  })

  test("Cash page — April has payments and operations", async ({ page }) => {
    await page.goto(`${BASE}/finance/cash?year=2026&month=4`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should show payments and operations
    expect(body).not.toContain("Нет оплат за")
    // Should show account operations
    expect(body).toMatch(/Инкассация|Выемка|операц/i)
  })

  test("Cash page — March has payments", async ({ page }) => {
    await page.goto(`${BASE}/finance/cash?year=2026&month=3`)
    await page.waitForLoadState("networkidle")
    const rows = page.locator("table tbody tr")
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("DDS report has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/dds?year=2026&month=3`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // DDS should show income/expense categories
    expect(body).toMatch(/Приход|Расход|Оплат|итого/i)
  })

  test("Debtors page has data", async ({ page }) => {
    await page.goto(`${BASE}/finance/debtors`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    // Should show debtors
    expect(body).toMatch(/Агеева|Беляков|Грищенко|должник/i)
  })

  test("Schedule page has lessons", async ({ page }) => {
    await page.goto(`${BASE}/schedule`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    expect(body).toMatch(/Робототехника|Английский|Рисование/i)
  })

  test("Reports catalog loads", async ({ page }) => {
    await page.goto(`${BASE}/reports`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    expect(body).toMatch(/Воронка|Отток|P&L|Свободные места/i)
  })

  test("Salary page has data", async ({ page }) => {
    await page.goto(`${BASE}/salary?year=2026&month=3`)
    await page.waitForLoadState("networkidle")
    const rows = page.locator("table tbody tr")
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test("Tasks page has pending tasks", async ({ page }) => {
    await page.goto(`${BASE}/tasks`)
    await page.waitForLoadState("networkidle")
    const body = await page.textContent("body")
    expect(body).toMatch(/Позвонить|Подготовить|задач/i)
  })
})
