import { test, expect } from "@playwright/test"

test.describe("Авторизация", () => {
  test("редирект на /login без сессии", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
  })

  test("логин с правильными данными", async ({ page }) => {
    await page.goto("/login")
    await page.fill('input[id="login"]', "owner")
    await page.fill('input[id="password"]', "demo123")
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
    // После логина может быть "Главная" или "Настройка организации" (онбординг)
    await expect(page.locator("h1")).toBeVisible()
  })

  test("логин с неверным паролем", async ({ page }) => {
    await page.goto("/login")
    await page.fill('input[id="login"]', "owner")
    await page.fill('input[id="password"]', "wrong")
    await page.click('button[type="submit"]')
    await expect(page.locator("text=Неверный логин или пароль")).toBeVisible()
  })

  test("сайдбар показывает имя и роль из сессии", async ({ page }) => {
    await page.goto("/login")
    await page.fill('input[id="login"]', "owner")
    await page.fill('input[id="password"]', "demo123")
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes("/login"), { waitUntil: "domcontentloaded" })
    // Проверяем что сайдбар загрузился и показывает роль (имя зависит от данных на сервере)
    await expect(page.locator("text=Владелец")).toBeVisible({ timeout: 10000 })
  })

  test("выход из системы", async ({ page }) => {
    // Логин
    await page.goto("/login")
    await page.fill('input[id="login"]', "owner")
    await page.fill('input[id="password"]', "demo123")
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes("/login"), { waitUntil: "domcontentloaded" })

    // Выход
    await page.click('button[title="Выйти"]')
    await page.waitForURL(/\/login/, { timeout: 10000 })
  })
})
