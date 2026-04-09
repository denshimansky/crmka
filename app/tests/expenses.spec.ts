import { test, expect, type Page } from "@playwright/test"

/**
 * РАСХОДЫ — полный бизнес-сценарий:
 *
 * 0. Создать счёт (если ещё нет)
 * 1. Страница загружается
 * 2. Открыть диалог создания
 * 3. Создать расход
 * 4. Проверить расход в таблице
 * 5. Проверить summary
 * 6. Отредактировать расход
 * 7. Удалить расход
 * 8. Кнопка копирования
 * 9. Все финансовые страницы
 */

const TS = Date.now().toString().slice(-6)
const ACCOUNT_NAME = `Касса-Расх-${TS}`
const COMMENT = `Тест-расход-${TS}`

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 10000, waitUntil: "domcontentloaded" })
}

test.describe.serial("Расходы — полный CRUD", () => {

  // === 0. СЧЁТ ===
  test("0. Создать счёт для расходов", async ({ page }) => {
    await login(page)
    await page.goto("/finance/cash")

    await page.locator("button", { hasText: "Счёт" }).first().click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    await dialog.locator("input").first().fill(ACCOUNT_NAME)

    await dialog.locator("[data-slot='select-trigger']").first().click()
    await page.waitForTimeout(500)
    await page.locator("[data-slot='select-item']:visible", { hasText: "Касса" }).first().click()
    await page.waitForTimeout(500)

    await dialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(2000)

    await page.goto("/finance/cash")
    await expect(page.locator(`text=${ACCOUNT_NAME}`).first()).toBeVisible({ timeout: 5000 })
  })

  // === 1. СТРАНИЦА ЗАГРУЖАЕТСЯ ===
  test("1. Страница расходов загружается", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")
    await expect(page.locator("h1")).toContainText("Расходы")

    await expect(page.locator("text=Расходы за месяц")).toBeVisible()
    await expect(page.locator("text=Постоянные")).toBeVisible()
    await expect(page.locator("text=Переменные")).toBeVisible()
    await expect(page.locator("text=Повторяющиеся")).toBeVisible()
  })

  // === 2. ДИАЛОГ СОЗДАНИЯ ===
  test("2. Открытие диалога создания расхода", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    await page.locator("button", { hasText: "Внести расход" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("text=Новый расход")).toBeVisible()

    await expect(dialog.locator("label:has-text('Статья расхода')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Сумма')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Дата')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Счёт')")).toBeVisible()
    await expect(dialog.locator("label:has-text('Комментарий')")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible({ timeout: 3000 })
  })

  // === 3. СОЗДАТЬ РАСХОД ===
  test("3. Создать расход", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    await page.locator("button", { hasText: "Внести расход" }).click()
    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    const selects = dialog.locator("[data-slot='select-trigger']")

    // 1. Статья расхода
    await selects.first().click()
    await page.waitForTimeout(500)
    const rentItem = page.locator("[data-slot='select-item']:visible", { hasText: "Аренда" })
    if (await rentItem.isVisible({ timeout: 2000 })) {
      await rentItem.click()
    } else {
      await page.locator("[data-slot='select-item']:visible").first().click()
    }
    await page.waitForTimeout(300)

    // 2. Сумма
    await dialog.locator("input[type='number']").first().fill("15000")

    // 3. Счёт
    await selects.nth(1).click()
    await page.waitForTimeout(500)
    await page.locator("[data-slot='select-item']:visible").first().click()
    await page.waitForTimeout(300)

    // 4. Повторяющийся
    await dialog.locator("text=Повторяющийся").click()
    await page.waitForTimeout(200)

    // 5. Комментарий — последний input без type=number и type=date
    const inputs = dialog.locator("input:not([type='number']):not([type='date'])")
    await inputs.last().fill(COMMENT)

    // Сохраняем
    await dialog.locator("button:has-text('Сохранить')").click()
    await page.waitForTimeout(3000)

    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  // === 4. ПРОВЕРИТЬ В ТАБЛИЦЕ ===
  test("4. Расход появился в таблице", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")
    await page.waitForTimeout(1000)
    // Reload для сброса RSC-кеша
    await page.reload()
    await page.waitForTimeout(2000)

    await expect(page.locator(`text=${COMMENT}`).first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator("text=15 000").first()).toBeVisible()
    await expect(page.locator("text=повтор").first()).toBeVisible()
  })

  // === 5. SUMMARY ===
  test("5. Summary-карточки обновились", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    await expect(page.locator("text=15 000").first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Итого по статьям")).toBeVisible()
  })

  // === 6. РЕДАКТИРОВАНИЕ ===
  test("6. Редактирование расхода", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    await page.locator(`tr:has-text("${COMMENT}")`).first().click()
    await page.waitForTimeout(500)

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("text=Редактировать расход")).toBeVisible()

    const amountInput = dialog.locator("input[type='number']").first()
    const currentAmount = await amountInput.inputValue()
    expect(currentAmount).toBe("15000")

    await amountInput.clear()
    await amountInput.fill("20000")

    await dialog.locator("button:has-text('Сохранить')").click()
    await page.waitForTimeout(3000)

    await page.goto("/finance/expenses")
    await expect(page.locator("text=20 000").first()).toBeVisible({ timeout: 5000 })
  })

  // === 7. УДАЛЕНИЕ ===
  test("7. Удаление расхода", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    await page.locator(`tr:has-text("${COMMENT}")`).first().click()
    await page.waitForTimeout(500)

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    page.on("dialog", d => d.accept())

    await dialog.locator("button:has-text('Удалить')").click()
    await page.waitForTimeout(3000)

    await page.goto("/finance/expenses")
    await page.waitForTimeout(1000)
    const hasComment = await page.locator(`text=${COMMENT}`).first().isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasComment).toBe(false)
  })

  // === 8. КОПИРОВАНИЕ ===
  test("8. Кнопка «Скопировать с прошлого месяца»", async ({ page }) => {
    await login(page)
    await page.goto("/finance/expenses")

    page.on("dialog", d => d.accept())

    const copyBtn = page.locator("button", { hasText: "Скопировать с прошлого месяца" })
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()
    await page.waitForTimeout(3000)
    // Кнопка отработала (нет крашей)
  })

  // === 9. ВСЕ ФИНАНСОВЫЕ СТРАНИЦЫ ===
  test("9. Все финансовые страницы загружаются", async ({ page }) => {
    await login(page)

    const pages: [string, string][] = [
      ["/finance/payments", "Оплаты"],
      ["/finance/cash", "Касса"],
      ["/finance/expenses", "Расходы"],
      ["/finance/dds", "ДДС"],
    ]

    for (const [path, title] of pages) {
      await page.goto(path)
      await expect(page.locator("h1")).toContainText(title, { timeout: 5000 })
    }
  })
})
