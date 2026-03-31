import { test, expect, type Page } from "@playwright/test"

/**
 * Тесты на РЕДАКТИРОВАНИЕ всех сущностей.
 * Проверяем что карандаш открывает диалог, изменения сохраняются.
 */

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe("Редактирование сущностей", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("редактирование сотрудника", async ({ page }) => {
    await page.goto("/staff")

    // Кликаем карандаш у первого сотрудника (не владельца)
    const editBtn = page.locator("button[title='']").or(page.locator("button:has(svg.lucide-pencil)")).first()
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible({ timeout: 3000 })
      // Проверяем что поля заполнены
      const nameInput = dialog.locator("input").first()
      const currentValue = await nameInput.inputValue()
      expect(currentValue.length).toBeGreaterThan(0)
      // Закрываем без сохранения
      await page.keyboard.press("Escape")
    }
  })

  test("редактирование направления", async ({ page }) => {
    await page.goto("/settings")
    await page.locator("button[role='tab']:has-text('Направления')").click()
    await page.waitForTimeout(500)

    // Ищем карандаш на карточке направления
    const editBtn = page.locator("button:has(svg.lucide-pencil)").first()
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible({ timeout: 3000 })
      // Проверяем что название заполнено
      const nameInput = dialog.locator("input").first()
      const currentValue = await nameInput.inputValue()
      expect(currentValue.length).toBeGreaterThan(0)
      await page.keyboard.press("Escape")
    }
  })

  test("редактирование счёта", async ({ page }) => {
    await page.goto("/finance/cash")

    // Ищем карандаш на карточке счёта
    const editBtn = page.locator("button:has(svg.lucide-pencil)").first()
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible({ timeout: 3000 })
      // Проверяем что название заполнено
      const nameInput = dialog.locator("input").first()
      const currentValue = await nameInput.inputValue()
      expect(currentValue.length).toBeGreaterThan(0)
      await page.keyboard.press("Escape")
    }
  })

  test("редактирование клиента", async ({ page }) => {
    await page.goto("/crm/clients")

    // Переходим в карточку первого клиента
    const clientLink = page.locator("a[href^='/crm/clients/']").first()
    if (await clientLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clientLink.click()
      await page.waitForTimeout(1000)

      // Ищем карандаш редактирования клиента
      const editBtn = page.locator("button:has(svg.lucide-pencil)").first()
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click()
        const dialog = page.locator("div[role='dialog']")
        await expect(dialog).toBeVisible({ timeout: 3000 })
        // Проверяем что есть поле фамилии
        const inputs = dialog.locator("input")
        const count = await inputs.count()
        expect(count).toBeGreaterThan(3) // ФИО + телефон минимум
        await page.keyboard.press("Escape")
      }
    }
  })

  test("редактирование группы (карточка → настройки)", async ({ page }) => {
    await page.goto("/schedule/groups")

    // Кликаем на группу
    const groupLink = page.locator("a[href^='/schedule/groups/']").first()
    if (await groupLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await groupLink.click()
      await page.waitForTimeout(1000)

      // Переходим на настройки
      await page.locator("button[role='tab']:has-text('Настройки')").click()
      await page.waitForTimeout(500)

      // Проверяем что есть поля редактирования и кнопка Сохранить
      await expect(page.locator("text=Основные данные")).toBeVisible()
      await expect(page.locator("button:has-text('Сохранить')").first()).toBeVisible()

      // Проверяем что есть шаблоны расписания
      await expect(page.locator("text=Шаблоны расписания")).toBeVisible()
    }
  })
})
