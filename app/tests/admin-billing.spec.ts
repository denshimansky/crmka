import { test, expect } from "@playwright/test"

const ADMIN_EMAIL = "admin@umnayacrm.ru"
const ADMIN_PASSWORD = "admin123"

async function adminLogin(page: any) {
  await page.goto("/admin/login")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(1500)

  // Ждём полной загрузки React-формы
  const emailInput = page.locator('input[id="email"]')
  await emailInput.waitFor({ state: "visible", timeout: 10000 })
  await page.waitForTimeout(500)

  await emailInput.click()
  await emailInput.fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)

  // Проверяем что поля заполнены
  await expect(emailInput).toHaveValue(ADMIN_EMAIL)
  await expect(page.locator('input[id="password"]')).toHaveValue(ADMIN_PASSWORD)

  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 15000 })
  await page.waitForSelector("table", { timeout: 10000 })
}

test.describe("Бэк-офис: Биллинг", () => {
  test("1. Логин в бэк-офис", async ({ page }) => {
    await page.goto("/admin/login")
    await expect(page.locator("h1")).toContainText("Бэк-офис")

    // Неверный пароль
    await page.fill('input[id="email"]', ADMIN_EMAIL)
    await page.fill('input[id="password"]', "wrong")
    await page.click('button[type="submit"]')
    await expect(page.locator("text=Неверный email или пароль")).toBeVisible({ timeout: 5000 })

    // Верные данные
    await page.fill('input[id="email"]', ADMIN_EMAIL)
    await page.fill('input[id="password"]', ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/partners/, { timeout: 15000 })
    await expect(page.locator("h1")).toContainText("Партнёры")
  })

  test("2. Страница партнёров — список видим", async ({ page }) => {
    await adminLogin(page)
    await expect(page.locator("h1")).toContainText("Партнёры")
    await expect(page.locator("table")).toBeVisible()
  })

  test("3. Создание нового партнёра", async ({ page }) => {
    await adminLogin(page)

    await page.click("text=Добавить партнёра")
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    const ts = Date.now().toString().slice(-6)
    const name = `Тест-Центр ${ts}`
    const dialog = page.locator('[role="dialog"]')
    const inputs = dialog.locator("input")

    // Организация: название, юрлицо, ИНН, телефон, email, контактное лицо
    await inputs.nth(0).fill(name)
    await inputs.nth(1).fill(`ООО "Тест ${ts}"`)
    await inputs.nth(2).fill(`77${ts}99`)
    await inputs.nth(3).fill("+7 (999) 111-22-33")
    await inputs.nth(4).fill(`test${ts}@example.com`)
    await inputs.nth(5).fill("Тестов Тест")
    // Владелец: фамилия, имя, логин, пароль, email
    await inputs.nth(6).fill("Тестов")
    await inputs.nth(7).fill("Тест")
    await inputs.nth(8).fill(`testowner${ts}`)
    await inputs.nth(9).fill("demo123")
    await inputs.nth(10).fill(`owner${ts}@example.com`)

    await dialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(3000)

    await expect(page.locator(`text=${name}`)).toBeVisible()
  })

  test("4. Карточка партнёра — просмотр и редактирование", async ({ page }) => {
    await adminLogin(page)

    // Открываем первого партнёра (кнопка-глазик)
    await page.locator("table tbody tr").first().locator("a").click()
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)
    await page.waitForSelector("text=Реквизиты", { timeout: 10000 })

    await expect(page.locator("text=Реквизиты").first()).toBeVisible()
    await expect(page.locator("text=Подписки").first()).toBeVisible()
    await expect(page.locator("text=Счета").first()).toBeVisible()

    // Запоминаем текущий контакт
    const currentContact = await page.locator("text=Контакт:").locator("..").locator("span").last().textContent()

    // Редактирование
    await page.locator("button:has-text('Редактировать')").click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    const dialog = page.locator('[role="dialog"]')
    const inputs = dialog.locator("input")
    // Контактное лицо — 6-й input (index 5): name, legalName, inn, phone, email, contactPerson
    await inputs.nth(5).fill("Обновлённый Контакт")
    await page.waitForTimeout(300)

    await dialog.locator("button:has-text('Сохранить')").click()
    await page.waitForTimeout(3000)

    // Перезагружаем страницу для проверки
    await page.reload()
    await page.waitForSelector("text=Реквизиты", { timeout: 10000 })
    await expect(page.locator("text=Обновлённый Контакт")).toBeVisible({ timeout: 5000 })
  })

  test("5. Тарифные планы — CRUD", async ({ page }) => {
    await adminLogin(page)

    await page.click("a[href='/admin/plans']")
    await page.waitForTimeout(1000)
    await expect(page.locator("h1")).toContainText("Тарифные планы")
    await expect(page.locator("text=Стандарт").first()).toBeVisible()

    // Создаём новый тариф
    await page.locator("button:has-text('Новый тариф')").click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    const ts = Date.now().toString().slice(-6)
    const planName = `Премиум ${ts}`
    const dialog = page.locator('[role="dialog"]')
    const inputs = dialog.locator("input")

    await inputs.nth(0).fill(planName)
    await inputs.nth(1).fill("10000")
    await inputs.nth(2).fill("Премиум для крупных сетей")

    await dialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(2000)

    await expect(page.locator(`text=${planName}`)).toBeVisible()

    // Редактирование
    await page.locator(`tr:has-text("${planName}")`).locator("button").first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const editDialog = page.locator('[role="dialog"]')
    await editDialog.locator("input").first().fill(`${planName} обн`)
    await editDialog.locator("button:has-text('Сохранить')").click()
    await page.waitForTimeout(2000)
    await expect(page.locator(`text=${planName} обн`)).toBeVisible()
  })

  test("6. Создание подписки для партнёра", async ({ page }) => {
    await adminLogin(page)

    await page.locator("table tbody tr").first().locator("a").click()
    await page.waitForTimeout(2000)

    await page.locator("button:has-text('Создать подписку')").click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    const dialog = page.locator('[role="dialog"]')

    // Кликаем на Select trigger для выбора плана
    await dialog.locator("button").first().click()
    await page.waitForTimeout(500)
    // Выбираем первый вариант в выпадающем списке
    const option = page.locator('[role="option"]').first()
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click()
    } else {
      // Попробуем найти listbox
      await page.locator('[role="listbox"] [role="option"]').first().click()
    }
    await page.waitForTimeout(500)

    // Кол-во филиалов
    await dialog.locator('input[type="number"]').fill("2")

    await dialog.locator("button:has-text('Создать')").click()
    await page.waitForTimeout(2000)

    // Проверяем — должна быть строка в таблице подписок (не "Нет подписок")
    await expect(page.locator("text=Нет подписок")).not.toBeVisible({ timeout: 5000 })
  })

  test("7. Выставление и оплата счёта", async ({ page }) => {
    await adminLogin(page)

    await page.locator("table tbody tr").first().locator("a").click()
    await page.waitForTimeout(2000)

    const invoiceBtn = page.locator("button:has-text('Выставить счёт')")
    if (await invoiceBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await invoiceBtn.click()
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

      const dialog = page.locator('[role="dialog"]')
      await dialog.locator("button:has-text('Выставить')").click()
      await page.waitForTimeout(2000)

      // Проверяем что счёт появился
      await expect(page.locator("text=INV-").first()).toBeVisible()

      // Отмечаем как оплаченный
      const paidBtn = page.locator("button:has-text('Оплачен')").first()
      if (await paidBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await paidBtn.click()
        await page.waitForTimeout(2000)
      }
    }
  })

  test("8. Страница всех счетов", async ({ page }) => {
    await adminLogin(page)

    await page.click("a[href='/admin/invoices']")
    await page.waitForTimeout(1000)
    await expect(page.locator("h1")).toContainText("Счета")
    await expect(page.locator("table")).toBeVisible()
  })

  test("9. Блокировка/разблокировка партнёра", async ({ page }) => {
    await adminLogin(page)

    await page.locator("table tbody tr").first().locator("a").click()
    await page.waitForTimeout(2000)

    const blockBtn = page.locator("button:has-text('Заблокировать')")
    if (await blockBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await blockBtn.click()
      await page.waitForTimeout(2000)
      // Проверяем badge около заголовка
      await expect(page.locator("h1 + span, h1 ~ [data-slot='badge']").first()).toBeVisible()

      // Разблокируем
      await page.locator("button:has-text('Разблокировать')").click()
      await page.waitForTimeout(2000)
      await expect(page.locator("button:has-text('Заблокировать')")).toBeVisible()
    }
  })

  test("10. Выход из бэк-офиса", async ({ page }) => {
    await adminLogin(page)
    await page.locator("button[title='Выйти']").click()
    await page.waitForURL(/\/admin\/login/, { timeout: 10000 })
    await expect(page.locator("h1")).toContainText("Бэк-офис")
  })
})
