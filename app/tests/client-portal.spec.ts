import { test, expect } from "@playwright/test"

// Логинимся как owner и генерируем portal link для первого клиента
async function getPortalLink(page: any): Promise<string> {
  await page.goto("/login")
  await page.waitForLoadState("networkidle")
  await page.locator('input[id="login"]').click()
  await page.locator('input[id="login"]').fill("owner")
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill("demo123")
  await page.waitForTimeout(200)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 15000, waitUntil: "domcontentloaded" })

  // Получаем список клиентов и берём первого
  const res = await page.request.get("/api/clients")
  const clients = await res.json()
  const clientId = clients[0]?.id
  if (!clientId) throw new Error("No clients found")

  // Генерируем portal link
  const linkRes = await page.request.post(`/api/clients/${clientId}/portal-link`)
  const linkData = await linkRes.json()
  return linkData.link
}

test.describe("ЛК клиента: Портал", () => {
  test("1. Портал недоступен без токена", async ({ page }) => {
    await page.goto("/portal")
    await page.waitForTimeout(2000)
    // Должно быть сообщение об ошибке
    await expect(page.locator("text=Для входа используйте ссылку от вашего центра")).toBeVisible({ timeout: 5000 })
  })

  test("2. Портал недоступен с неверным токеном", async ({ page }) => {
    await page.goto("/portal?token=invalid-token-123")
    await page.waitForTimeout(2000)
    await expect(page.locator("text=Недействительная ссылка")).toBeVisible({ timeout: 5000 })
  })

  test("3. Генерация portal-link из CRM", async ({ page }) => {
    const link = await getPortalLink(page)
    expect(link).toContain("/portal?token=")
  })

  test("4. Согласие ПДн при первом входе", async ({ page }) => {
    const link = await getPortalLink(page)

    // Открываем портал по ссылке
    await page.goto(link)
    await page.waitForTimeout(2000)

    // Должна быть форма согласия
    await expect(page.locator("text=Согласие на обработку персональных данных")).toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Личный кабинет").first()).toBeVisible()

    // Даём согласие
    await page.click("button:has-text('Согласен')")
    await page.waitForTimeout(2000)

    // После согласия должен появиться интерфейс ЛК
    await expect(page.locator("text=Баланс").first()).toBeVisible({ timeout: 5000 })
  })

  test("5. Портал показывает данные клиента", async ({ page }) => {
    // Сначала генерируем новый линк и даём согласие
    const link = await getPortalLink(page)
    await page.goto(link)
    await page.waitForTimeout(2000)

    // Согласие
    const consentBtn = page.locator("button:has-text('Согласен')")
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click()
      await page.waitForTimeout(2000)
    }

    // Проверяем основные секции
    await expect(page.locator("text=Баланс").first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Абонементы").first()).toBeVisible()
    await expect(page.locator("text=Расписание").first()).toBeVisible()
    await expect(page.locator("text=История оплат").first()).toBeVisible()
  })

  test("6. Карточки-метрики видимы", async ({ page }) => {
    const link = await getPortalLink(page)
    await page.goto(link)
    await page.waitForTimeout(2000)

    const consentBtn = page.locator("button:has-text('Согласен')")
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click()
      await page.waitForTimeout(2000)
    }

    await expect(page.locator("text=Баланс").first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=Абонементы").first()).toBeVisible()
    await expect(page.locator("text=Занятий на неделе")).toBeVisible()
  })

  test("7. Выход из портала", async ({ page }) => {
    const link = await getPortalLink(page)
    await page.goto(link)
    await page.waitForTimeout(2000)

    const consentBtn = page.locator("button:has-text('Согласен')")
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click()
      await page.waitForTimeout(2000)
    }

    // Кликаем выход
    await page.locator("button[title='Выйти']").click()
    await page.waitForTimeout(2000)

    // Должно показать сообщение о выходе
    await expect(page.locator("text=Вы вышли из личного кабинета")).toBeVisible({ timeout: 5000 })
  })
})
