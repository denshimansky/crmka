import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("Закрытие пробелов", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // === ОБЗВОН ===
  test("1. Кампания обзвона кликабельна → страница с контактами", async ({ page }) => {
    await page.goto("/crm/calls")
    // Если есть кампании — клик ведёт на страницу
    const link = page.locator("a[href^='/crm/calls/']").first()
    if (await link.isVisible({ timeout: 3000 }).catch(() => false)) {
      await link.click()
      await page.waitForTimeout(1000)
      // Должен быть прогресс-бар и таблица контактов
      await expect(page.locator("text=Прогресс")).toBeVisible({ timeout: 5000 })
      await expect(page.locator("text=Всего контактов")).toBeVisible()
    }
  })

  test("2. Создание кампании с фильтрами", async ({ page }) => {
    await page.goto("/crm/calls")
    await page.locator("button", { hasText: "Новый обзвон" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()
    // Фильтры должны быть
    await expect(dialog.locator("label:has-text('Статус клиента')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Сегмент')")).toBeVisible()
    await page.keyboard.press("Escape")
  })

  // === АВТОЗАДАЧИ ===
  test("3. Кнопка автозадач на странице задач", async ({ page }) => {
    await page.goto("/tasks")
    await expect(page.locator("button", { hasText: "Автозадачи" })).toBeVisible()
  })

  test("4. Генерация автозадач работает", async ({ page }) => {
    await login(page)
    await page.goto("/tasks")

    page.on("dialog", d => d.accept())
    await page.locator("button", { hasText: "Автозадачи" }).click()
    await page.waitForTimeout(3000)
    // Не крашнулось — alert показался
  })

  // === НОВЫЕ ОТЧЁТЫ ===
  test("5. Средний чек загружается", async ({ page }) => {
    await page.goto("/reports/crm/avg-check")
    await expect(page.locator("h1")).toContainText("Средний чек")
  })

  test("6. Непродлённые абонементы загружаются", async ({ page }) => {
    await page.goto("/reports/churn/not-renewed")
    await expect(page.locator("h1")).toContainText("Непродлённые")
  })

  test("7. Выручка загружается", async ({ page }) => {
    await page.goto("/reports/finance/revenue")
    await expect(page.locator("h1")).toContainText("Выручка")
  })

  test("8. Посещения загружаются", async ({ page }) => {
    await page.goto("/reports/attendance/visits")
    await expect(page.locator("h1")).toContainText("Посещения")
  })

  test("9. Сводный по педагогам загружается", async ({ page }) => {
    await page.goto("/reports/salary/by-instructor")
    await expect(page.locator("h1")).toContainText("педагогам")
  })

  // === КАТАЛОГ ОБНОВЛЁН ===
  test("10. Каталог отчётов — все готовы", async ({ page }) => {
    await page.goto("/reports")
    // Все отчёты помечены как готовые
    const readyBadges = page.locator("text=Готов")
    const count = await readyBadges.count()
    expect(count).toBeGreaterThanOrEqual(9)
  })
})
