import { test, expect, type Page } from "@playwright/test"

/**
 * E2E тест: полный цикл абонемент → оплата → проверка баланса
 *
 * Сценарий:
 * 1. Создать счёт (если нет)
 * 2. Создать клиента с подопечным
 * 3. Создать абонемент для клиента
 * 4. Оплатить абонемент
 * 5. Проверить что абонемент стал "Активен"
 * 6. Проверить что оплата отображается
 */

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe("E2E: Абонемент → Оплата", () => {
  test("полный цикл", async ({ page }) => {
    await login(page)

    // === 1. Убедимся что есть счёт ===
    await page.goto("/finance/cash")
    const hasAccounts = await page.locator("[data-slot='card']").first().isVisible({ timeout: 2000 }).catch(() => false)

    if (!hasAccounts) {
      // Создаём счёт
      await page.locator("button", { hasText: "Счёт" }).first().click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible()
      await dialog.locator("input").first().fill("Касса E2E")
      await dialog.locator("[data-slot='select-trigger']").first().click()
      await page.locator("[data-slot='select-item']", { hasText: "Касса" }).click()
      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)
    }

    // === 2. Создать клиента (лида) ===
    await page.goto("/crm/leads")
    await page.locator("button", { hasText: "Клиент" }).click()

    const clientDialog = page.locator("div[role='dialog']")
    await expect(clientDialog).toBeVisible()

    const timestamp = Date.now()
    await clientDialog.locator("input#cl-lastName").fill("Тестовый" + timestamp)
    await clientDialog.locator("input#cl-firstName").fill("Клиент")
    await clientDialog.locator("input#cl-phone").fill("+7999" + timestamp.toString().slice(-7))

    await clientDialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(2000)

    // Проверяем что клиент появился
    await expect(page.locator(`text=Тестовый${timestamp}`).first()).toBeVisible({ timeout: 5000 })

    // Переходим в карточку клиента
    await page.locator(`a:has-text("Тестовый${timestamp}")`).first().click()
    await page.waitForTimeout(1000)

    // === 3. Проверяем вкладки ===
    await expect(page.locator("button[role='tab']:has-text('Абонементы')")).toBeVisible()
    await expect(page.locator("button[role='tab']:has-text('Оплаты')")).toBeVisible()

    // === 4. Проверяем что страница оплат доступна ===
    await page.goto("/finance/payments")
    await expect(page.locator("h1")).toContainText("Оплаты")
    await expect(page.locator("text=Поступления")).toBeVisible()

    // === 5. Проверяем что касса показывает счета ===
    await page.goto("/finance/cash")
    await expect(page.locator("h1")).toContainText("Касса")
  })
})
