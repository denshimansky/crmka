import { test, expect, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("Новые экраны и функции", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // 1. Каналы привлечения
  test("Каналы привлечения — страница загружается, таблица видна", async ({ page }) => {
    await page.goto("/settings/channels")
    await expect(page.locator("h1")).toContainText("Каналы привлечения", { timeout: 10000 })
    // Должна быть таблица каналов или пустое состояние
    const hasTable = page.locator("table")
    const hasEmpty = page.locator("text=Нет каналов привлечения")
    await expect(hasTable.or(hasEmpty).first()).toBeVisible({ timeout: 10000 })
  })

  // 2. Причины пропусков
  test("Причины пропусков — страница загружается", async ({ page }) => {
    await page.goto("/settings/absence-reasons")
    await expect(page.locator("h1")).toContainText("Причины пропусков", { timeout: 10000 })
    // Кнопка добавления
    await expect(page.locator("button:has-text('Причина')")).toBeVisible()
  })

  // 3. Интеграции
  test("Интеграции — страница загружается, карточки провайдеров", async ({ page }) => {
    await page.goto("/settings/integrations")
    await expect(page.locator("h1")).toContainText("Интеграции", { timeout: 10000 })
    // Карточки провайдеров (Wazzup, Mango Office, SMS.ru)
    await expect(page.locator("text=Wazzup").first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator("text=Mango Office").first()).toBeVisible()
    await expect(page.locator("text=SMS.ru").first()).toBeVisible()
  })

  // 4. Потенциальный отток
  test("Потенциальный отток — страница загружается", async ({ page }) => {
    await page.goto("/reports/churn/potential")
    await expect(page.locator("h1")).toContainText("Потенциальный отток", { timeout: 10000 })
    // Карточки метрик
    await expect(page.locator("text=Учеников в зоне риска").first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Порог прогулов").first()).toBeVisible()
  })

  // 5. Карточка клиента — таб коммуникации
  test("Карточка клиента — таб Коммуникации существует", async ({ page }) => {
    await page.goto("/crm/clients")
    // Кликаем первого клиента в списке
    const clientLink = page.locator("table tbody tr a").first()
    await expect(clientLink).toBeVisible({ timeout: 10000 })
    await clientLink.click()
    await page.waitForTimeout(1000)

    // Проверяем наличие таба Коммуникации
    await expect(page.locator("button[role='tab']:has-text('Коммуникации')")).toBeVisible({ timeout: 5000 })
  })

  // 6. Печать расписания
  test("Расписание — кнопка печати видна", async ({ page }) => {
    await page.goto("/schedule")
    await expect(page.locator("h1")).toContainText("Расписание", { timeout: 10000 })
    await expect(page.locator("button:has-text('Печать')")).toBeVisible({ timeout: 5000 })
  })

  // 7. Отмена дня
  test("Расписание — кнопка «Отменить день» видна", async ({ page }) => {
    await page.goto("/schedule")
    await expect(page.locator("h1")).toContainText("Расписание", { timeout: 10000 })
    await expect(page.locator("button:has-text('Отменить день')")).toBeVisible({ timeout: 5000 })
  })

  // 8. Быстрый лид
  test("Главная — кнопка «Новый лид» (быстрое создание)", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("h1")).toContainText("Главная", { timeout: 10000 })
    // FAB-кнопка в правом нижнем углу
    await expect(page.locator("button:has-text('Новый лид')")).toBeVisible({ timeout: 5000 })
  })

  // 9. Экспорт Excel
  test("P&L отчёт — кнопка «Скачать Excel» видна", async ({ page }) => {
    await page.goto("/reports/finance/pnl")
    await expect(page.locator("h1")).toContainText("P&L", { timeout: 10000 })
    await expect(page.locator("button:has-text('Скачать Excel')")).toBeVisible({ timeout: 5000 })
  })

  // 10. Drill-down
  test("P&L отчёт — кликабельная сумма drill-down", async ({ page }) => {
    await page.goto("/reports/finance/pnl")
    await expect(page.locator("h1")).toContainText("P&L", { timeout: 10000 })
    // Drill-down суммы имеют класс cursor-pointer и underline
    const drilldownSpan = page.locator("span.cursor-pointer.underline").first()
    await expect(drilldownSpan).toBeVisible({ timeout: 10000 })
  })
})
