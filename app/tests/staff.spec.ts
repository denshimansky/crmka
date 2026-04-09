import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("Сотрудники", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("список сотрудников загружается", async ({ page }) => {
    await page.goto("/staff")
    await expect(page.locator("h1")).toContainText("Сотрудники")
    // Должны быть демо-сотрудники из seed
    await expect(page.locator("td:has-text('Соколова')").first()).toBeVisible()
  })

  test("создание сотрудника", async ({ page }) => {
    await page.goto("/staff")
    // Кликаем кнопку "+ Сотрудник"
    await page.locator("button", { hasText: "Сотрудник" }).click()

    // Ждём диалог
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.locator('input[id="lastName"]').fill("Тестов")
    await dialog.locator('input[id="firstName"]').fill("Тест")
    await dialog.locator('input[id="login"]').fill("testuser_" + Date.now())
    await dialog.locator('input[id="password"]').fill("test123456")

    await dialog.locator("button:has-text('Создать')").click()

    // Диалог закрылся, сотрудник в списке
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Тестов").first()).toBeVisible()
  })

  test("админ не видит кнопку создания", async ({ page }) => {
    // Выходим
    await page.click('button[title="Выйти"]')
    await page.waitForURL(/\/login/)

    // Логинимся как админ
    await page.fill('input[id="login"]', "admin")
    await page.fill('input[id="password"]', "demo123")
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes("/login"), { waitUntil: "domcontentloaded" })

    await page.goto("/staff")
    await expect(page.locator("h1")).toContainText("Сотрудники")
    await expect(page.locator("button:has-text('Сотрудник')")).not.toBeVisible()
  })
})
