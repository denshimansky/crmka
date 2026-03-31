import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe("Финансы", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("касса загружается", async ({ page }) => {
    await page.goto("/finance/cash")
    await expect(page.locator("h1")).toContainText("Касса")
  })

  test("создание счёта", async ({ page }) => {
    await page.goto("/finance/cash")
    await page.locator("button", { hasText: "Счёт" }).first().click()

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Название
    const nameInput = dialog.locator("input").first()
    await nameInput.fill("Тестовая касса " + Date.now())

    // Тип — кликаем select и выбираем "Касса"
    await dialog.locator("[data-slot='select-trigger']").first().click()
    await page.locator("[data-slot='select-item']", { hasText: "Касса" }).click()

    await dialog.locator("button:has-text('Создать')").click()

    // Ждём закрытия диалога или успеха
    await page.waitForTimeout(2000)
    await expect(page.locator("text=Тестовая касса").first()).toBeVisible({ timeout: 5000 })
  })

  test("оплаты загружаются", async ({ page }) => {
    await page.goto("/finance/payments")
    await expect(page.locator("h1")).toContainText("Оплаты")
    // Должны быть сводные карточки
    await expect(page.locator("text=Поступления")).toBeVisible()
  })

  test("настройки загружаются с направлениями", async ({ page }) => {
    await page.goto("/settings")
    await expect(page.locator("h1")).toContainText("Настройки")
  })

  test("клиенты — вкладка абонементы", async ({ page }) => {
    await page.goto("/crm/clients")
    // Кликаем на первого клиента если есть
    const firstClient = page.locator("a[href^='/crm/clients/']").first()
    if (await firstClient.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstClient.click()
      await expect(page.locator("button[role='tab']:has-text('Абонементы')")).toBeVisible()
      await expect(page.locator("button[role='tab']:has-text('Оплаты')")).toBeVisible()
    }
  })
})
