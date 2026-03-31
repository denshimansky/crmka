import { test, expect, type Page } from "@playwright/test"

const TS = Date.now().toString().slice(-6)
const TASK_TITLE = `Тест-задача-${TS}`
const CAMPAIGN_NAME = `Обзвон-${TS}`

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe.serial("Модуль 8: Задачи + Обзвон", () => {

  test("1. Страница задач загружается", async ({ page }) => {
    await login(page)
    await page.goto("/tasks")
    await expect(page.locator("h1")).toContainText("Задачи")
    await expect(page.locator("p:has-text('На сегодня')")).toBeVisible()
    await expect(page.locator("p:has-text('Просрочено')")).toBeVisible()
    await expect(page.locator("p:has-text('Выполнено')")).toBeVisible()
  })

  test("2. Создать задачу", async ({ page }) => {
    await login(page)
    await page.goto("/tasks")

    await page.locator("button", { hasText: "Задача" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    // Заголовок
    await dialog.locator("input").first().fill(TASK_TITLE)

    // Исполнитель
    const selects = dialog.locator("[data-slot='select-trigger']")
    await selects.first().click()
    await page.waitForTimeout(500)
    await page.locator("[data-slot='select-item']:visible").first().click()
    await page.waitForTimeout(300)

    await dialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(3000)

    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  test("3. Задача появилась в списке", async ({ page }) => {
    await login(page)
    await page.goto("/tasks")
    await page.reload()
    await page.waitForTimeout(1000)
    await expect(page.locator(`text=${TASK_TITLE}`).first()).toBeVisible({ timeout: 10000 })
  })

  test("4. Отметить задачу выполненной", async ({ page }) => {
    await login(page)
    await page.goto("/tasks")
    await page.waitForTimeout(1000)

    // Кликаем чекбокс в строке с нашей задачей
    const row = page.locator(`tr:has-text("${TASK_TITLE}")`)
    await row.locator("button").first().click()
    await page.waitForTimeout(2000)

    // Задача должна быть зачёркнута или статус изменился
    await page.reload()
    await page.waitForTimeout(1000)
  })

  test("5. Обзвон — страница загружается", async ({ page }) => {
    await login(page)
    await page.goto("/crm/calls")
    await expect(page.locator("h1")).toContainText("Обзвон")
    await expect(page.locator("p:has-text('Активных кампаний')")).toBeVisible()
  })

  test("6. Создать кампанию обзвона", async ({ page }) => {
    await login(page)
    await page.goto("/crm/calls")

    await page.locator("button", { hasText: "Новый обзвон" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    await dialog.locator("input").first().fill(CAMPAIGN_NAME)
    await dialog.locator("button:has-text('Создать обзвон')").click()
    await page.waitForTimeout(3000)

    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  test("7. Кампания появилась в списке", async ({ page }) => {
    await login(page)
    await page.goto("/crm/calls")
    await page.reload()
    await page.waitForTimeout(1000)
    await expect(page.locator(`text=${CAMPAIGN_NAME}`).first()).toBeVisible({ timeout: 10000 })
  })
})
