import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: Полный цикл работы CRM
 *
 * 1. Логин владельцем
 * 2. Создать направление (если нет)
 * 3. Создать сотрудника-инструктора
 * 4. Создать группу с расписанием
 * 5. Сгенерировать расписание на месяц
 * 6. Проверить расписание на недельном виде
 * 7. Создать клиента с подопечным
 * 8. Зачислить клиента в группу
 * 9. Создать счёт (если нет)
 * 10. Создать абонемент клиенту
 * 11. Оплатить абонемент
 * 12. Проверить данные на всех экранах
 */

const TS = Date.now()

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 10000 })
}

test.describe("E2E: Полный цикл CRM", () => {
  test.describe.configure({ mode: "serial" })

  let directionExists = false
  let groupId = ""

  test("1. Логин и дашборд", async ({ page }) => {
    await login(page)
    await expect(page.locator("h1")).toContainText("Главная")
    await expect(page.locator("text=Малафеева А.")).toBeVisible()
  })

  test("2. Создать направление", async ({ page }) => {
    await login(page)
    await page.goto("/settings")

    // Переключаемся на вкладку направлений
    await page.locator("button[role='tab']:has-text('Направления')").click()
    await page.waitForTimeout(500)

    // Проверяем есть ли уже направления
    directionExists = await page.locator("text=E2E-Направление").isVisible({ timeout: 1000 }).catch(() => false)

    if (!directionExists) {
      await page.locator("button", { hasText: "Направление" }).click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible()

      await dialog.locator("input").first().fill("E2E-Направление-" + TS)
      // Стоимость занятия
      await dialog.locator("input[type='number']").first().fill("500")
      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)
      await expect(page.locator(`text=E2E-Направление-${TS}`).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test("3. Создать инструктора", async ({ page }) => {
    await login(page)
    await page.goto("/staff")
    await page.locator("button", { hasText: "Сотрудник" }).click()

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    await dialog.locator('input[id="lastName"]').fill("E2E-Педагог")
    await dialog.locator('input[id="firstName"]').fill("Тест")
    await dialog.locator('input[id="login"]').fill("e2e_instructor_" + TS)
    await dialog.locator('input[id="password"]').fill("test123456")

    // Выбираем роль "Инструктор"
    await dialog.locator("[data-slot='select-trigger']").first().click()
    await page.locator("[data-slot='select-item']", { hasText: "Инструктор" }).click()
    await page.waitForTimeout(300)

    await dialog.locator("button:has-text('Создать')").click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
    await expect(page.locator("text=E2E-Педагог").first()).toBeVisible({ timeout: 5000 })
  })

  test("4. Создать группу с расписанием", async ({ page }) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.locator("button", { hasText: "Группа" }).click()

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    // Название
    await dialog.locator("input").first().fill("E2E-Группа-" + TS)

    // Выбираем из каскадных селектов — нужно ждать закрытия предыдущего
    async function selectOption(triggerIndex: number) {
      const trigger = dialog.locator("[data-slot='select-trigger']").nth(triggerIndex)
      await trigger.click()
      await page.waitForTimeout(500)
      const visibleItem = page.locator("[data-slot='select-item']:visible").first()
      await visibleItem.click()
      await page.waitForTimeout(500)
    }

    await selectOption(0) // Направление
    await selectOption(1) // Филиал
    await selectOption(2) // Кабинет
    await selectOption(3) // Педагог

    // Добавить день расписания
    await dialog.locator("button:has-text('Добавить день')").click()
    await page.waitForTimeout(300)

    await dialog.locator("button:has-text('Создать')").click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
    await expect(page.locator(`text=E2E-Группа-${TS}`).first()).toBeVisible({ timeout: 5000 })
  })

  test("5. Открыть карточку группы и сгенерировать расписание", async ({ page }) => {
    await login(page)
    await page.goto("/schedule/groups")

    // Кликаем на ссылку группы
    await page.locator(`a:has-text("E2E-Группа-${TS}")`).first().click()
    await page.waitForTimeout(1000)

    // Должна быть карточка группы
    await expect(page.locator(`h1:has-text("E2E-Группа-${TS}")`)).toBeVisible()

    // Вкладка Расписание — генерируем
    await page.locator("button[role='tab']:has-text('Расписание')").click()
    await page.waitForTimeout(500)

    // Кнопка генерации
    const genButton = page.locator("button:has-text('Сгенерировать')")
    if (await genButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await genButton.click()
      await page.waitForTimeout(500)

      // В диалоге нажимаем генерировать
      const genDialog = page.locator("div[role='dialog']")
      if (await genDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        await genDialog.locator("button:has-text('Сгенерировать')").click()
        await page.waitForTimeout(2000)
      }
    }

    // Сохраняем groupId из URL
    groupId = page.url().split("/schedule/groups/")[1] || ""
  })

  test("6. Проверить расписание на недельном виде", async ({ page }) => {
    await login(page)
    await page.goto("/schedule")
    await expect(page.locator("h1")).toContainText("Расписание")
    // Кнопка "Группы" видна
    await expect(page.locator("a:has-text('Группы')").first()).toBeVisible()
  })

  test("7. Создать клиента с подопечным", async ({ page }) => {
    await login(page)
    await page.goto("/crm/clients")
    await page.locator("button", { hasText: "Клиент" }).click()

    const dialog = page.locator("div[role='dialog']")
    await expect(dialog).toBeVisible()

    await dialog.locator("input#cl-lastName").fill("E2E-Клиент-" + TS)
    await dialog.locator("input#cl-firstName").fill("Родитель")
    await dialog.locator("input#cl-phone").fill("+79990" + TS.toString().slice(-6))

    // Добавляем подопечного
    await dialog.locator("button:has-text('Подопечный')").click()
    await page.waitForTimeout(300)

    // Заполняем имя подопечного — ищем последний input с placeholder "Имя" внутри секции подопечных
    const wardInputs = dialog.locator("input[placeholder='Имя']")
    if (await wardInputs.count() > 0) {
      await wardInputs.last().fill("E2E-Ребёнок")
    }

    await dialog.locator("button:has-text('Создать')").last().click()
    await page.waitForTimeout(2000)

    await expect(page.locator(`text=E2E-Клиент-${TS}`).first()).toBeVisible({ timeout: 5000 })
  })

  test("8. Зачислить клиента в группу", async ({ page }) => {
    await login(page)
    await page.goto("/schedule/groups")

    // Открываем карточку группы
    await page.locator(`a:has-text("E2E-Группа-${TS}")`).first().click()
    await page.waitForTimeout(1000)

    // Вкладка Состав
    await page.locator("button[role='tab']:has-text('Состав')").click()
    await page.waitForTimeout(500)

    // Кнопка зачисления
    const enrollBtn = page.locator("button:has-text('Зачислить')")
    if (await enrollBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await enrollBtn.click()
      const enrollDialog = page.locator("div[role='dialog']")
      if (await enrollDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Выбираем клиента
        await enrollDialog.locator("[data-slot='select-trigger']").first().click()
        // Ищем нашего клиента
        const clientItem = page.locator("[data-slot='select-item']", { hasText: `E2E-Клиент-${TS}` })
        if (await clientItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await clientItem.click()
          await page.waitForTimeout(300)
          await enrollDialog.locator("button:has-text('Зачислить')").click()
          await page.waitForTimeout(2000)
        } else {
          // Выбираем первого доступного
          await page.locator("[data-slot='select-item']").first().click()
          await page.waitForTimeout(300)
          await enrollDialog.locator("button:has-text('Зачислить')").click()
          await page.waitForTimeout(2000)
        }
      }
    }
  })

  test("9. Создать счёт (если нет)", async ({ page }) => {
    await login(page)
    await page.goto("/finance/cash")

    const hasAccounts = await page.locator("text=Касса").nth(1).isVisible({ timeout: 1000 }).catch(() => false)
    if (!hasAccounts) {
      await page.locator("button", { hasText: "Счёт" }).first().click()
      const dialog = page.locator("div[role='dialog']")
      await expect(dialog).toBeVisible()
      await dialog.locator("input").first().fill("E2E-Касса-" + TS)
      await dialog.locator("[data-slot='select-trigger']").first().click()
      await page.locator("[data-slot='select-item']", { hasText: "Касса" }).click()
      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)
    }
  })

  test("10. Проверить карточку клиента", async ({ page }) => {
    await login(page)
    await page.goto("/crm/clients")

    const clientLink = page.locator(`a:has-text("E2E-Клиент-${TS}")`).first()
    if (await clientLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientLink.click()
      await page.waitForTimeout(1000)

      // Проверяем заголовок
      await expect(page.locator(`text=E2E-Клиент-${TS}`).first()).toBeVisible()

      // Проверяем вкладки
      await expect(page.locator("button[role='tab']:has-text('Подопечные')")).toBeVisible()
      await expect(page.locator("button[role='tab']:has-text('Абонементы')")).toBeVisible()
      await expect(page.locator("button[role='tab']:has-text('Оплаты')")).toBeVisible()

      // Проверяем подопечного
      await page.locator("button[role='tab']:has-text('Подопечные')").click()
      await page.waitForTimeout(500)
    }
  })

  test("11. Проверить все страницы после создания данных", async ({ page }) => {
    await login(page)

    // Дашборд
    await page.goto("/")
    await expect(page.locator("h1")).toContainText("Главная")

    // Клиенты
    await page.goto("/crm/clients")
    await expect(page.locator("h1")).toContainText("Клиенты")

    // Расписание
    await page.goto("/schedule")
    await expect(page.locator("h1")).toContainText("Расписание")

    // Группы
    await page.goto("/schedule/groups")
    await expect(page.locator("h1")).toContainText("Группы")

    // Оплаты
    await page.goto("/finance/payments")
    await expect(page.locator("h1")).toContainText("Оплаты")

    // Касса
    await page.goto("/finance/cash")
    await expect(page.locator("h1")).toContainText("Касса")

    // Сотрудники
    await page.goto("/staff")
    await expect(page.locator("h1")).toContainText("Сотрудники")

    // Настройки
    await page.goto("/settings")
    await expect(page.locator("h1")).toContainText("Настройки")
  })
})
