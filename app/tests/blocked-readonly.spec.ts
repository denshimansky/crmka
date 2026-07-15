/**
 * Read-only режим неплательщика (billingStatus="blocked"):
 * — страницы и отчёты открываются, видна красная плашка;
 * — мутации к /api/* дают 403 { code: "BILLING_READ_ONLY" };
 * — белый список работает: PUT /api/billing, отметка уведомлений;
 * — /billing доступен для оплаты.
 *
 * Сетап: суперадмин блокирует демо-организацию через /api/admin/partners,
 * owner логинится ПОСЛЕ блокировки (JWT сразу несёт blocked — рефреш
 * токена раз в 5 минут в тесте не ждём). Teardown возвращает active.
 */
import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test"

const ADMIN_EMAIL = "admin@umnayacrm.ru"
const ADMIN_PASSWORD = "admin123"
const ORG_NAME = "Умные дети" // демо-организация owner/demo123

let admin: APIRequestContext
let partnerId: string

async function loginAsOwner(page: Page) {
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(1500)
  await page.locator('input[id="login"]').click()
  await page.locator('input[id="login"]').fill("owner")
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill("demo123")
  await page.waitForTimeout(200)
  await page.click('button[type="submit"]')
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), {
    timeout: 15000,
    waitUntil: "domcontentloaded",
  })
}

async function setBillingStatus(status: "active" | "blocked") {
  const res = await admin.patch(`/api/admin/partners/${partnerId}`, {
    data: { billingStatus: status },
  })
  expect(res.ok()).toBeTruthy()
}

test.describe.serial("Read-only режим заблокированного партнёра", () => {
  test.beforeAll(async ({ baseURL }) => {
    admin = await pwRequest.newContext({ baseURL })
    const login = await admin.post("/api/admin/auth", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(login.ok()).toBeTruthy()

    const partners = await (await admin.get("/api/admin/partners")).json()
    const list = Array.isArray(partners) ? partners : partners.items || []
    const target = list.find((p: { name?: string }) => (p.name || "").includes(ORG_NAME))
    expect(target, `организация «${ORG_NAME}» не найдена в /api/admin/partners`).toBeTruthy()
    partnerId = target.id

    await setBillingStatus("blocked")
  })

  test.afterAll(async () => {
    // Возвращаем организацию в active, что бы ни случилось в тестах
    if (admin && partnerId) {
      await setBillingStatus("active")
      await admin.dispose()
    }
  })

  test("страницы открываются, видна плашка режима просмотра", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/crm/clients")
    await page.waitForLoadState("domcontentloaded")

    await expect(
      page.locator("text=Счёт не оплачен — CRM в режиме просмотра").first()
    ).toBeVisible({ timeout: 10000 })
    // Контент страницы при этом доступен (read-only, не редирект)
    await expect(page).toHaveURL(/\/crm\/clients/)
    // Ссылка на оплату ведёт в /billing
    await expect(page.locator("a[href='/billing']", { hasText: "Перейти к оплате" })).toBeVisible()
  })

  test("мутации к API дают 403 BILLING_READ_ONLY", async ({ page }) => {
    await loginAsOwner(page)

    const res = await page.request.post("/api/clients", { data: {} })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("BILLING_READ_ONLY")
  })

  test("чтение API работает (GET не блокируется)", async ({ page }) => {
    await loginAsOwner(page)
    const res = await page.request.get("/api/clients")
    expect(res.status(), "GET должен проходить в режиме просмотра").toBeLessThan(400)
  })

  test("белый список: смена периода оплаты и отметка уведомлений работают", async ({ page }) => {
    await loginAsOwner(page)

    // PUT /api/billing — нужен, чтобы оплатить (белый список)
    const billing = await page.request.get("/api/billing")
    expect(billing.status()).toBeLessThan(400)
    const data = await billing.json()
    if (data.subscription) {
      const res = await page.request.put("/api/billing", {
        data: { billingPeriodMonths: data.subscription.billingPeriodMonths },
      })
      expect(res.status(), "PUT /api/billing должен работать у заблокированного").toBeLessThan(400)
    }

    // Отметка уведомлений прочитанными (PUT /api/notifications/[id]) — не проверяем
    // на конкретном уведомлении (его может не быть), но убеждаемся, что метод
    // не зарезан middleware-ом: несуществующий id должен дать не-403 ответ
    const notif = await page.request.put("/api/notifications/00000000-0000-0000-0000-000000000000", {
      data: { isRead: true },
    })
    expect(notif.status(), "PUT /api/notifications не должен резаться middleware").not.toBe(403)
  })

  test("страница /billing доступна для оплаты", async ({ page }) => {
    await loginAsOwner(page)
    await page.goto("/billing")
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator("h1")).toContainText("Подписка", { timeout: 10000 })
  })
})
