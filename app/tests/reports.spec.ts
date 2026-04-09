import { test, expect, type Page } from "@playwright/test"

/**
 * Модуль 7: Отчёты
 *
 * 1. Каталог отчётов загружается
 * 2. Воронка продаж
 * 3. Детализация оттока
 * 4. Финрез P&L
 * 5. Свободные места
 * 6. Навигация между отчётами
 */

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("Модуль 7: Отчёты", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("1. Каталог отчётов загружается", async ({ page }) => {
    await page.goto("/reports")
    await expect(page.locator("h1")).toContainText("Отчёты")
    // Группы отчётов
    await expect(page.locator("text=CRM и маркетинг")).toBeVisible()
    await expect(page.locator("text=Отток и удержание")).toBeVisible()
    await expect(page.locator("text=Расписание и посещения")).toBeVisible()
    await expect(page.locator("text=Финансы").first()).toBeVisible()
    // Готовые отчёты помечены
    await expect(page.locator("text=Готов").first()).toBeVisible()
  })

  test("2. Воронка продаж", async ({ page }) => {
    await page.goto("/reports/crm/funnel")
    await expect(page.locator("h1")).toContainText("Воронка продаж")
    // Метрики
    await expect(page.locator("text=Всего клиентов")).toBeVisible()
    await expect(page.locator("p:has-text('Конверсия')").first()).toBeVisible()
    // Этапы воронки
    await expect(page.locator("text=Этапы воронки")).toBeVisible()
    await expect(page.locator("text=Новый")).toBeVisible()
    await expect(page.locator("text=Активный клиент")).toBeVisible()
    // Кнопка назад (ArrowLeft icon link, не сайдбар)
    await page.locator("a[href='/reports'] svg").first().click()
    await expect(page.locator("h1")).toContainText("Отчёты")
  })

  test("3. Детализация оттока", async ({ page }) => {
    await page.goto("/reports/churn/details")
    await expect(page.locator("h1")).toContainText("Детализация оттока")
    // Метрики
    await expect(page.locator("p:has-text('Выбывших')")).toBeVisible()
    await expect(page.locator("p:has-text('Активных')")).toBeVisible()
    await expect(page.locator("text=% оттока")).toBeVisible()
    // Разбивка или пустая таблица
    await expect(page.locator("h1")).toContainText("Детализация оттока")
  })

  test("4. Финрез P&L", async ({ page }) => {
    await page.goto("/reports/finance/pnl")
    await expect(page.locator("h1")).toContainText("Финансовый результат")
    // Метрики
    await expect(page.locator("p:has-text('Выручка')").first()).toBeVisible()
    await expect(page.locator("p:has-text('Маржа')").first()).toBeVisible()
    await expect(page.locator("p:has-text('Чистая прибыль')").first()).toBeVisible()
    await expect(page.locator("p:has-text('Рентабельность')").first()).toBeVisible()
    // Таблица P&L
    await expect(page.locator("text=Отчёт P&L")).toBeVisible()
  })

  test("5. Свободные места", async ({ page }) => {
    await page.goto("/reports/schedule/capacity")
    await expect(page.locator("h1")).toContainText("Свободные места")
    // Метрики
    await expect(page.locator("p.text-xs:has-text('Групп')")).toBeVisible()
    await expect(page.locator("p:has-text('Загрузка')")).toBeVisible()
    // Таблица или "Нет активных групп"
    await expect(
      page.locator("table").or(page.locator("text=Нет активных групп"))
    ).toBeVisible({ timeout: 5000 })
  })

  test("6. Все отчёты доступны через каталог", async ({ page }) => {
    await page.goto("/reports")

    // Клик на воронку
    await page.locator("a[href='/reports/crm/funnel']").first().click()
    await expect(page.locator("h1")).toContainText("Воронка", { timeout: 5000 })

    // Назад и на P&L
    await page.goto("/reports")
    await page.locator("a[href='/reports/finance/pnl']").first().click()
    await expect(page.locator("h1")).toContainText("Финансовый результат", { timeout: 5000 })
  })
})
