import { test, expect } from "@playwright/test"

async function loginAsOwner(page: any) {
  await page.goto("/login")
  await page.waitForLoadState("networkidle")
  await page.locator('input[id="login"]').click()
  await page.locator('input[id="login"]').fill("owner")
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill("demo123")
  await page.waitForTimeout(200)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 15000, waitUntil: "domcontentloaded" })
}

test.describe("ЛК партнёра: Подписка", () => {
  test("1. Пункт «Подписка» в сайдбаре (только owner)", async ({ page }) => {
    await loginAsOwner(page)
    // Ищем ссылку «Подписка» в сайдбаре
    await expect(page.locator("a[href='/billing']")).toBeVisible()
    await expect(page.locator("text=Подписка").first()).toBeVisible()
  })

  test("2. Страница подписки загружается", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/billing")
    await page.waitForLoadState("networkidle")

    await expect(page.locator("h1")).toContainText("Подписка")
    await expect(page.locator("text=Управление подпиской и счетами")).toBeVisible()
  })

  test("3. Карточки-метрики отображаются", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/billing")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    // Должны быть 4 карточки
    await expect(page.locator("text=Тариф").first()).toBeVisible()
    await expect(page.locator("text=К оплате").first()).toBeVisible()
    await expect(page.locator("text=Следующая оплата").first()).toBeVisible()
    await expect(page.locator("text=Всего оплачено").first()).toBeVisible()
  })

  test("4. Информация об организации и подписке", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/billing")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    // Карточка организации
    await expect(page.locator("text=Организация").first()).toBeVisible()

    // Карточка подписки
    await expect(page.locator("text=Подписка").nth(1)).toBeVisible()

    // Должен быть тариф "Стандарт" из seed
    await expect(page.locator("text=Стандарт").first()).toBeVisible()
  })

  test("5. История счетов видна", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/billing")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    await expect(page.locator("text=История счетов")).toBeVisible()
    // Таблица счетов
    await expect(page.locator("table").last()).toBeVisible()
  })

  test("6. Администратор не видит подписку", async ({ page }) => {
    await page.goto("/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[id="login"]').click()
    await page.locator('input[id="login"]').fill("admin")
    await page.locator('input[id="password"]').click()
    await page.locator('input[id="password"]').fill("demo123")
    await page.waitForTimeout(200)
    await page.click('button[type="submit"]')
    await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 15000, waitUntil: "domcontentloaded" })

    // Ссылка «Подписка» не должна быть видна для admin
    await expect(page.locator("a[href='/billing']")).not.toBeVisible()
  })

  test("7. Переход из сайдбара на /billing", async ({ page }) => {
    await loginAsOwner(page)
    await page.locator("a[href='/billing']").click()
    await page.waitForURL("/billing", { timeout: 10000 })
    await expect(page.locator("h1")).toContainText("Подписка")
  })
})
