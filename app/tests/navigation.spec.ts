import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("Навигация", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  const pages = [
    { path: "/", title: "Главная" },
    { path: "/crm/clients", title: "Клиенты" },
    { path: "/schedule", title: "Расписание" },
    { path: "/schedule/groups", title: "Группы" },
    { path: "/finance/payments", title: "Оплаты" },
    { path: "/finance/cash", title: "Касса" },
    { path: "/staff", title: "Сотрудники" },
    { path: "/settings", title: "Настройки" },
    { path: "/changelog", title: "Changelog" },
  ]

  for (const p of pages) {
    test(`${p.path} — загружается`, async ({ page }) => {
      await page.goto(p.path)
      await expect(page.locator("h1")).toContainText(p.title)
    })
  }
})
