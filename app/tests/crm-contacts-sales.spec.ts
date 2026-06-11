import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 10000,
    waitUntil: "domcontentloaded",
  })
}

test.describe("CRM: Контакты и Продажи", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("Старая /crm/funnel редиректит на /crm/sales", async ({ page }) => {
    await page.goto("/crm/funnel")
    await expect(page).toHaveURL(/\/crm\/sales/)
    await expect(page.locator("h1")).toContainText("Продажи")
  })

  test("Старая /crm/leads редиректит на /crm/contacts?tab=leads", async ({ page }) => {
    await page.goto("/crm/leads")
    await expect(page).toHaveURL(/\/crm\/contacts\?tab=leads/)
    await expect(page.locator("h1")).toContainText("Клиенты")
  })

  test("Старая /crm/clients редиректит на /crm/contacts?tab=active", async ({ page }) => {
    await page.goto("/crm/clients")
    await expect(page).toHaveURL(/\/crm\/contacts\?tab=active/)
    await expect(page.locator("h1")).toContainText("Клиенты")
  })

  test("Страница Контактов: все вкладки видны", async ({ page }) => {
    await page.goto("/crm/contacts")
    await expect(page.locator("h1")).toContainText("Клиенты")
    // Проверяем что все 8 вкладок отрендерены
    for (const label of ["Лиды", "Потенциал", "Нецелевой", "Активные", "Выбывшие", "Архив", "Чёрный список", "Все"]) {
      await expect(page.locator(`a:has-text("${label}")`).first()).toBeVisible()
    }
  })

  test("Страница Продажи: все 4 вкладки видны", async ({ page }) => {
    await page.goto("/crm/sales")
    await expect(page.locator("h1")).toContainText("Продажи")
    for (const label of ["Заявка", "Пробное", "Прошёл пробное", "Ожидаем оплату"]) {
      await expect(page.locator(`a:has-text("${label}")`).first()).toBeVisible()
    }
  })

  test("Переключение вкладок Контактов меняет URL", async ({ page }) => {
    await page.goto("/crm/contacts?tab=leads")
    await page.locator('a:has-text("Активные")').first().click()
    await expect(page).toHaveURL(/tab=active/)
  })

  test("API /api/applications POST требует обязательные поля", async ({ request }) => {
    const res = await request.post("/api/applications", {
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  test("API /api/sales отдаёт массив для каждой вкладки", async ({ request }) => {
    for (const tab of ["application", "trial", "trial_done", "awaiting_payment"]) {
      const res = await request.get(`/api/sales?tab=${tab}`)
      expect(res.status()).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
    }
  })
})
