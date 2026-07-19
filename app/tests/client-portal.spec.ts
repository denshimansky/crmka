import { test, expect, type Page } from "@playwright/test"

// ЛК родителя v2: вход по телефону+паролю на /p/<slug>, гейт согласий,
// кабинет с разрезом по подопечным. Тесты последовательные: перевыпуск
// пароля убивает предыдущие сессии, параллельные воркеры мешали бы друг другу.

test.describe.configure({ mode: "serial" })

// Мобильный вьюпорт — портал mobile-first
test.use({ viewport: { width: 390, height: 844 } })

const DOC_URL = "https://example.com/doc.pdf"

type PortalAccount = {
  loginPhone: string
  password: string
  portalUrl: string
}

// Уникальный телефон на прогон — исключает дубли в демо-базе
const uniquePhone = `+7999${String(Date.now()).slice(-7)}`

async function loginAsOwner(page: Page) {
  await page.goto("/login")
  await page.waitForLoadState("networkidle")
  await page.locator('input[id="login"]').fill("owner")
  await page.locator('input[id="password"]').fill("demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), {
    timeout: 15000,
    waitUntil: "domcontentloaded",
  })
}

// Owner настраивает документы и выдаёт учётку клиенту с уникальным телефоном
async function issuePortalAccount(page: Page): Promise<PortalAccount> {
  await loginAsOwner(page)

  // 4 обязательных документа — без них выдача заблокирована (422)
  const patchRes = await page.request.patch("/api/organization", {
    data: {
      portalOfferUrl: DOC_URL,
      portalPrivacyPolicyUrl: DOC_URL,
      portalPdnParentConsentUrl: DOC_URL,
      portalPdnChildConsentUrl: DOC_URL,
    },
  })
  expect(patchRes.ok()).toBeTruthy()

  // Клиент (не лид) с уникальным валидным телефоном
  const res = await page.request.get("/api/clients")
  const clients = await res.json()
  const client = clients.find((c: { clientStatus: string | null }) => c.clientStatus)
  if (!client) throw new Error("Нет клиентов со статусом в демо-базе")
  const phoneRes = await page.request.patch(`/api/clients/${client.id}`, {
    data: { phone: uniquePhone },
  })
  expect(phoneRes.ok()).toBeTruthy()

  const issueRes = await page.request.post(`/api/clients/${client.id}/portal-account`)
  expect(issueRes.ok()).toBeTruthy()
  const data = await issueRes.json()
  expect(data.password).toBeTruthy()
  expect(data.portalUrl).toContain("/p/")
  return { loginPhone: data.loginPhone, password: data.password, portalUrl: data.portalUrl }
}

function portalPath(account: PortalAccount): string {
  return new URL(account.portalUrl).pathname
}

// Вход + гейт согласий (если ещё не пройден) — до видимого кабинета
async function loginToCabinet(page: Page, account: PortalAccount) {
  await page.goto(portalPath(account))
  await page.locator('input[id="portal-phone"]').fill(account.loginPhone)
  await page.locator('input[id="portal-password"]').fill(account.password)
  await page.click('button[type="submit"]')
  await page.waitForURL("**/cabinet/**", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)

  const gateButton = page.locator("button:has-text('Войти в кабинет')")
  if (await gateButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    for (const checkbox of await page.locator('input[type="checkbox"]:not(:disabled)').all()) {
      await checkbox.check()
    }
    await gateButton.click()
    await page.waitForTimeout(2000)
  }
  await expect(page.locator("text=Баланс").first()).toBeVisible({ timeout: 10000 })
}

test.describe("ЛК родителя: вход и кабинет", () => {
  let account: PortalAccount

  test("1. Выдача учётки из CRM (документы + телефон + пароль)", async ({ page }) => {
    account = await issuePortalAccount(page)
    expect(account.loginPhone).toMatch(/^7\d{10}$/)
    expect(account.password).toMatch(/^[2-9a-z]{4}-[2-9a-z]{4}$/)
  })

  test("2. Страница входа центра открывается", async ({ page }) => {
    await page.goto(portalPath(account))
    await expect(page.locator("text=Личный кабинет").first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('input[id="portal-phone"]')).toBeVisible()
    await expect(page.locator('input[id="portal-password"]')).toBeVisible()
  })

  test("3. Неверный пароль отклоняется", async ({ page }) => {
    await page.goto(portalPath(account))
    await page.locator('input[id="portal-phone"]').fill(account.loginPhone)
    await page.locator('input[id="portal-password"]').fill("wrong-pass")
    await page.click('button[type="submit"]')
    await expect(page.locator("text=Неверный телефон или пароль")).toBeVisible({ timeout: 5000 })
  })

  test("4. Гейт согласий: кнопка активна только после обязательных галочек", async ({ page }) => {
    await page.goto(portalPath(account))
    await page.locator('input[id="portal-phone"]').fill(account.loginPhone)
    await page.locator('input[id="portal-password"]').fill(account.password)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2500)

    const gateButton = page.locator("button:has-text('Войти в кабинет')")
    // Гейт показывается при первом входе; если согласия уже даны — кабинет сразу
    if (await gateButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(gateButton).toBeDisabled()
      for (const checkbox of await page.locator('input[type="checkbox"]:not(:disabled)').all()) {
        await checkbox.check()
      }
      await expect(gateButton).toBeEnabled()
      await gateButton.click()
      await page.waitForTimeout(2000)
    }
    await expect(page.locator("text=Баланс").first()).toBeVisible({ timeout: 10000 })
  })

  test("5. Кабинет: обзор подопечного (абонементы, занятия)", async ({ page }) => {
    await loginToCabinet(page, account)
    await expect(page.locator("text=Абонементы").first()).toBeVisible()
    await expect(page.locator("text=Ближайшие занятия").first()).toBeVisible()
  })

  test("6. Навигация: Посещения, История, Оплаты", async ({ page }) => {
    await loginToCabinet(page, account)

    await page.click("nav >> text=Посещения")
    await expect(page.locator("text=Посещения").first()).toBeVisible({ timeout: 5000 })

    await page.click("nav >> text=История")
    await expect(page.locator("text=История").first()).toBeVisible({ timeout: 5000 })

    await page.click("nav >> text=Оплаты")
    await expect(page.locator("text=История оплат").first()).toBeVisible({ timeout: 5000 })
  })

  test("7. Выход возвращает на форму входа", async ({ page }) => {
    await loginToCabinet(page, account)
    await page.locator("button[title='Выйти']").click()
    await page.waitForTimeout(2000)
    await expect(page.locator('input[id="portal-phone"]')).toBeVisible({ timeout: 5000 })
  })

  test("8. Перевыпуск пароля убивает старую сессию", async ({ page }) => {
    await loginToCabinet(page, account)

    // Owner перевыпускает пароль в другом контексте (request с куками owner)
    const ownerPage = await page.context().browser()!.newPage()
    const newAccount = await issuePortalAccount(ownerPage)
    await ownerPage.close()

    // Старая сессия родителя мертва: data-запрос отдаёт 401
    const meRes = await page.request.get("/api/portal/me")
    expect(meRes.status()).toBe(401)

    account = newAccount
  })
})

test.describe("ЛК родителя: legacy-ссылки", () => {
  test("9. /portal без токена — сообщение о переезде", async ({ page }) => {
    await page.goto("/portal")
    await expect(page.locator("text=Личный кабинет переехал")).toBeVisible({ timeout: 5000 })
  })

  test("10. /portal с неверным токеном — сообщение о переезде", async ({ page }) => {
    await page.goto("/portal?token=invalid-token-123")
    await expect(page.locator("text=Личный кабинет переехал")).toBeVisible({ timeout: 5000 })
  })

  test("11. Несуществующий слаг — 404", async ({ page }) => {
    const res = await page.goto("/p/no-such-center-xyz")
    expect(res?.status()).toBe(404)
  })
})
