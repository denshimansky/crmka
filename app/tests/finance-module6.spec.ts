import { test, expect, type Page } from "@playwright/test"

/**
 * Модуль 6: ДДС + Зарплата + Должники
 *
 * 1. ДДС загружается с summary-карточками
 * 2. ДДС показывает таблицы приход/расход
 * 3. ДДС показывает остатки по счетам
 * 4. Зарплата загружается с ведомостью
 * 5. Зарплата — кнопка «Провести выплату» открывает диалог
 * 6. Зарплата — провести выплату
 * 7. Должники загружаются
 * 8. Должники — ссылки ведут в карточку клиента
 * 9. Все новые страницы в навигации
 */

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe("Модуль 6: ДДС, Зарплата, Должники", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // === ДДС ===
  test("1. ДДС загружается с summary", async ({ page }) => {
    await page.goto("/finance/dds")
    await expect(page.locator("h1")).toContainText("ДДС")
    await expect(page.locator("p:has-text('Приход')").first()).toBeVisible()
    await expect(page.locator("p:has-text('Расход')").first()).toBeVisible()
    await expect(page.locator("text=Остаток на счетах")).toBeVisible()
  })

  test("2. ДДС показывает таблицы", async ({ page }) => {
    await page.goto("/finance/dds")
    // Должны быть карточки Приход и Расход
    await expect(page.locator("text=Итого приход").or(page.locator("text=Нет поступлений")).first()).toBeVisible()
    await expect(page.locator("text=Итого расход").or(page.locator("text=Нет расходов")).first()).toBeVisible()
  })

  test("3. ДДС показывает остатки по счетам", async ({ page }) => {
    await page.goto("/finance/dds")
    await expect(page.locator("text=Остатки по счетам")).toBeVisible()
    // Должна быть таблица со счетами или "Нет счетов"
    await expect(page.locator("text=Касса").or(page.locator("text=Р/С")).or(page.locator("text=Нет счетов")).first()).toBeVisible({ timeout: 5000 })
  })

  // === ЗАРПЛАТА ===
  test("4. Зарплата загружается с ведомостью", async ({ page }) => {
    await page.goto("/salary")
    await expect(page.locator("h1")).toContainText("Зарплата")
    await expect(page.locator("p:has-text('Начислено')")).toBeVisible()
    await expect(page.locator("p:has-text('Выплачено')")).toBeVisible()
    await expect(page.locator("p:has-text('Осталось')")).toBeVisible()
    await expect(page.locator("text=Ведомость")).toBeVisible()
  })

  test("5. Зарплата — диалог выплаты", async ({ page }) => {
    await page.goto("/salary")

    await page.locator("button", { hasText: "Провести выплату" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("text=Выплата зарплаты")).toBeVisible()
    await expect(dialog.locator("label:has-text('Сотрудник')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Сумма')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Счёт')")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible({ timeout: 3000 })
  })

  test("6. Зарплата — провести выплату", async ({ page }) => {
    await page.goto("/salary")

    await page.locator("button", { hasText: "Провести выплату" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    const selects = dialog.locator("[data-slot='select-trigger']")

    // Сотрудник
    await selects.first().click()
    await page.waitForTimeout(500)
    await page.locator("[data-slot='select-item']:visible").first().click()
    await page.waitForTimeout(300)

    // Сумма
    await dialog.locator("input[type='number']").first().fill("1000")

    // Счёт
    await selects.nth(1).click()
    await page.waitForTimeout(500)
    await page.locator("[data-slot='select-item']:visible").first().click()
    await page.waitForTimeout(300)

    // Комментарий
    const inputs = dialog.locator("input:not([type='number']):not([type='date'])")
    await inputs.last().fill("Тест-выплата")

    await dialog.locator("button:has-text('Выплатить')").click()
    await page.waitForTimeout(3000)

    // Диалог закрылся
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  // === ДОЛЖНИКИ ===
  test("7. Должники загружаются", async ({ page }) => {
    await page.goto("/finance/debtors")
    await expect(page.locator("h1")).toContainText("Должники")
    await expect(page.locator("text=Общий долг")).toBeVisible()
    await expect(page.locator("p:has-text('Должников')")).toBeVisible()
    // Может быть таблица или "Нет должников"
    await expect(page.locator("table").or(page.locator("text=Нет должников")).first()).toBeVisible({ timeout: 5000 })
  })

  test("8. Должники — ссылка ведёт в карточку", async ({ page }) => {
    await page.goto("/finance/debtors")

    // Если есть должники — клик по ссылке ведёт в карточку
    const firstLink = page.locator("a[href^='/crm/clients/']").first()
    if (await firstLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstLink.click()
      await page.waitForTimeout(1000)
      // Должна открыться карточка клиента
      await expect(page.locator("button[role='tab']:has-text('Абонементы')")).toBeVisible({ timeout: 5000 })
    }
  })

  // === НАВИГАЦИЯ ===
  test("9. Все новые страницы в сайдбаре", async ({ page }) => {
    await page.goto("/")

    // Проверяем ссылки в сайдбаре
    await expect(page.locator("a[href='/finance/dds']")).toBeVisible()
    await expect(page.locator("a[href='/finance/debtors']")).toBeVisible()
    await expect(page.locator("a[href='/salary']")).toBeVisible()

    // Переходы работают
    const pages: [string, string][] = [
      ["/finance/dds", "ДДС"],
      ["/finance/debtors", "Должники"],
      ["/salary", "Зарплата"],
    ]

    for (const [path, title] of pages) {
      await page.goto(path)
      await expect(page.locator("h1")).toContainText(title, { timeout: 5000 })
    }
  })
})
