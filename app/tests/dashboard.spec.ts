import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe("Модуль 9: Дашборд", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("1. Дашборд загружается с реальными данными", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("h1")).toContainText("Главная")
    // Карточки статистики
    await expect(page.locator("text=Активные абонементы")).toBeVisible()
    await expect(page.locator("text=Выручка за месяц")).toBeVisible()
    await expect(page.locator("text=Расходы за месяц")).toBeVisible()
    // Дата
    await expect(page.locator("text=2026")).toBeVisible()
  })

  test("2. Виджеты задач и неотмеченных", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("text=Задачи на сегодня")).toBeVisible()
    await expect(page.locator("text=Неотмеченные занятия")).toBeVisible()
  })

  test("3. Виджет воронки продаж", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("text=Воронка продаж")).toBeVisible()
    await expect(page.locator("text=Новые")).toBeVisible()
    await expect(page.locator("text=Активные")).toBeVisible()
  })

  test("4. Ссылки ведут в разделы", async ({ page }) => {
    await page.goto("/")
    // Клик на карточку расходов
    await page.locator("a[href='/finance/expenses']").click()
    await expect(page.locator("h1")).toContainText("Расходы", { timeout: 5000 })

    // Назад и клик на должников
    await page.goto("/")
    await page.locator("a[href='/finance/debtors']").click()
    await expect(page.locator("h1")).toContainText("Должники", { timeout: 5000 })
  })
})
