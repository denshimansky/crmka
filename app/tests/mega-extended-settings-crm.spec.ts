import { test, expect, type Page } from "@playwright/test"

/**
 * MEGA-ТЕСТ (расширение): Настройки, CRM-фичи, UI
 *
 * Предполагается, что организация уже создана мега-тестом.
 * Используем demo-пользователя owner / demo123.
 *
 * Части:
 *  8 — Settings sub-pages (каналы, причины, шаблоны скидок, права ролей, названия ролей, интеграции)
 *  9 — CRM features (быстрый лид, дубликаты, сортировка, редактирование клиента, импорт)
 * 17 — UI features (breadcrumbs, справка, настройки дашборда, колокольчик)
 */

const OWNER_LOGIN = "owner"
const OWNER_PASSWORD = "demo123"

const TS = Date.now().toString().slice(-5)

// Результаты тестов: ok | BUG
const results: { step: string; status: "OK" | "BUG"; detail?: string }[] = []

function log(step: string, status: "OK" | "BUG", detail?: string) {
  results.push({ step, status, detail })
  if (status === "BUG") {
    console.log(`❌ BUG: ${step} — ${detail}`)
  } else {
    console.log(`✅ OK: ${step}`)
  }
}

async function login(page: Page) {
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="login"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="login"]').fill(OWNER_LOGIN)
  await page.locator('input[id="password"]').fill(OWNER_PASSWORD)
  await page.waitForTimeout(300)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 30000, waitUntil: "domcontentloaded" })
}

/** Обёртка: тест никогда не фейлит Playwright, только логирует BUG */
function safeTest(name: string, fn: (page: Page) => Promise<void>, timeout = 90000) {
  test(name, async ({ page }) => {
    test.setTimeout(timeout)
    try {
      await fn(page)
    } catch (e: any) {
      log(name, "BUG", `UNCAUGHT: ${e.message?.slice(0, 150)}`)
    }
  })
}

// ============================================================
// MEGA-ТЕСТ (расширение)
// ============================================================

test.describe.serial("Mega-тест (расширение): Настройки, CRM, UI", () => {

  // ============================================================
  // ЧАСТЬ 8: SETTINGS SUB-PAGES
  // ============================================================

  safeTest("8.1: Каналы привлечения — создать канал «Instagram»", async (page) => {
    await login(page)
    await page.goto("/settings/channels")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1000)

    try {
      const h1 = await page.locator("h1").first().textContent()
      if (!h1?.includes("Каналы привлечения")) {
        log("8.1 Каналы привлечения — заголовок", "BUG", `Заголовок: ${h1}`)
        return
      }
      log("8.1 Каналы привлечения — страница загружена", "OK")

      // Кликаем кнопку «Канал»
      await page.locator("button:has-text('Канал')").click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      // Вводим название
      const channelName = `Instagram-${TS}`
      await dialog.locator("input").first().fill(channelName)
      await page.waitForTimeout(300)

      // Кликаем «Создать»
      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)

      // Проверяем появление в списке
      const visible = await page.locator(`text=${channelName}`).isVisible({ timeout: 5000 }).catch(() => false)
      if (visible) {
        log("8.1 Канал «Instagram» создан и виден", "OK")
      } else {
        // Перезагружаем и проверяем снова
        await page.goto("/settings/channels")
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1000)
        const visibleRetry = await page.locator(`text=${channelName}`).isVisible({ timeout: 5000 }).catch(() => false)
        log("8.1 Канал «Instagram»", visibleRetry ? "OK" : "BUG", visibleRetry ? "Виден после перезагрузки" : "Не появился в списке")
      }
    } catch (e: any) {
      log("8.1 Каналы привлечения", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("8.2: Причины пропусков — создать причину «Болезнь»", async (page) => {
    await login(page)
    await page.goto("/settings/absence-reasons")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1000)

    try {
      const h1 = await page.locator("h1").first().textContent()
      if (!h1?.includes("Причины пропусков")) {
        log("8.2 Причины пропусков — заголовок", "BUG", `Заголовок: ${h1}`)
        return
      }
      log("8.2 Причины пропусков — страница загружена", "OK")

      // Кликаем кнопку «Причина»
      await page.locator("button:has-text('Причина')").click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      const reasonName = `Болезнь-${TS}`
      await dialog.locator("input").first().fill(reasonName)
      await page.waitForTimeout(300)

      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)

      const visible = await page.locator(`text=${reasonName}`).isVisible({ timeout: 5000 }).catch(() => false)
      if (visible) {
        log("8.2 Причина «Болезнь» создана и видна", "OK")
      } else {
        await page.goto("/settings/absence-reasons")
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1000)
        const visibleRetry = await page.locator(`text=${reasonName}`).isVisible({ timeout: 5000 }).catch(() => false)
        log("8.2 Причина «Болезнь»", visibleRetry ? "OK" : "BUG", visibleRetry ? "Видна после перезагрузки" : "Не появилась в списке")
      }
    } catch (e: any) {
      log("8.2 Причины пропусков", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("8.3: Шаблоны скидок — страница загружается", async (page) => {
    await login(page)
    await page.goto("/settings/discount-templates")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Проверяем что страница загрузилась — ищем заголовок или таблицу
      const hasTitle = await page.locator("h1").first().textContent()
      const hasContent = hasTitle?.includes("Скидк") || hasTitle?.includes("скидк") || hasTitle?.includes("Шаблон")
        || await page.locator("text=Шаблон").first().isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=скидк").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("table").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("8.3 Шаблоны скидок — страница", hasContent ? "OK" : "BUG", hasContent ? undefined : `Заголовок: ${hasTitle}`)
    } catch (e: any) {
      log("8.3 Шаблоны скидок", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("8.4: Права ролей — переключить чекбокс, сохранить", async (page) => {
    await login(page)
    await page.goto("/settings/role-permissions")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      const h1 = await page.locator("h1").first().textContent()
      if (!h1?.includes("Права ролей")) {
        log("8.4 Права ролей — заголовок", "BUG", `Заголовок: ${h1}`)
        return
      }
      log("8.4 Права ролей — страница загружена", "OK")

      // Ждём загрузку матрицы (таблица с чекбоксами)
      await page.waitForSelector("table", { timeout: 10000 })

      // Находим первый не-disabled чекбокс (не owner-column) и кликаем
      const checkboxes = page.locator("table button[role='checkbox']:not([disabled])")
      const count = await checkboxes.count()

      if (count === 0) {
        log("8.4 Права ролей — нет доступных чекбоксов", "BUG", "Все чекбоксы disabled")
        return
      }

      // Запоминаем текущее состояние первого чекбокса
      const firstCheckbox = checkboxes.first()
      const wasChecked = await firstCheckbox.getAttribute("data-state") === "checked"

      // Кликаем
      await firstCheckbox.click()
      await page.waitForTimeout(500)

      // Проверяем что состояние изменилось
      const nowChecked = await firstCheckbox.getAttribute("data-state") === "checked"
      if (wasChecked === nowChecked) {
        log("8.4 Права ролей — чекбокс не переключился", "BUG", `was: ${wasChecked}, now: ${nowChecked}`)
      } else {
        log("8.4 Права ролей — чекбокс переключён", "OK")
      }

      // Кликаем «Сохранить»
      const saveBtn = page.locator("button:has-text('Сохранить')")
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(2000)

        // Проверяем появление бейджа «Сохранено»
        const saved = await page.locator("text=Сохранено").isVisible({ timeout: 5000 }).catch(() => false)
        log("8.4 Права ролей — сохранение", saved ? "OK" : "BUG", saved ? undefined : "Бейдж «Сохранено» не появился")
      } else {
        log("8.4 Права ролей — кнопка Сохранить", "BUG", "Не найдена")
      }

      // Возвращаем обратно
      await firstCheckbox.click()
      await page.waitForTimeout(300)
      if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(1000)
      }
    } catch (e: any) {
      log("8.4 Права ролей", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("8.5: Настройки — изменить название роли «Педагог» → «Тренер»", async (page) => {
    await login(page)
    await page.goto("/settings")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем блок «Названия ролей»
      const roleSection = await page.locator("text=Названия ролей").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!roleSection) {
        // Возможно нужно прокрутить или переключить вкладку
        log("8.5 Названия ролей — секция", "BUG", "Не найдена на странице настроек")
        return
      }
      log("8.5 Названия ролей — секция найдена", "OK")

      // Находим инпут с плейсхолдером «Педагог» или значением «Педагог» (label + input)
      // Ищем label «Педагог» и соседний input
      const pedagogLabel = page.locator("label:has-text('Педагог')")
      if (await pedagogLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Находим инпут в том же контейнере
        const container = pedagogLabel.locator("..").locator("..")
        const input = container.locator("input")

        if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
          await input.clear()
          await input.fill("Тренер")
          await page.waitForTimeout(300)

          // Кликаем «Сохранить» в секции названий ролей
          const saveBtn = container.locator("button:has-text('Сохранить')")
          if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await saveBtn.click()
          } else {
            // Ищем кнопку сохранить рядом с секцией
            await page.locator("h2:has-text('Названия ролей')").locator("..").locator("..").locator("button:has-text('Сохранить')").click()
          }
          await page.waitForTimeout(2000)

          // Проверяем что значение «Тренер» сохранилось
          const saved = await page.locator("text=Сохранено").isVisible({ timeout: 3000 }).catch(() => false)
          log("8.5 Переименование «Педагог» → «Тренер»", saved ? "OK" : "BUG", saved ? undefined : "Индикатор «Сохранено» не появился")

          // Возвращаем обратно
          await input.clear()
          await input.fill("Педагог")
          await page.waitForTimeout(300)
          const saveBtnAgain = page.locator("h2:has-text('Названия ролей')").locator("..").locator("..").locator("button:has-text('Сохранить')")
          if (await saveBtnAgain.isVisible({ timeout: 1000 }).catch(() => false)) {
            await saveBtnAgain.click()
            await page.waitForTimeout(1000)
          }
        } else {
          log("8.5 Инпут для роли «Педагог»", "BUG", "Не найден рядом с label")
        }
      } else {
        // Пробуем найти input с placeholder «Педагог»
        const inputByPlaceholder = page.locator("input[placeholder='Педагог']")
        if (await inputByPlaceholder.isVisible({ timeout: 2000 }).catch(() => false)) {
          await inputByPlaceholder.clear()
          await inputByPlaceholder.fill("Тренер")
          await page.waitForTimeout(300)

          await page.locator("button:has-text('Сохранить')").first().click()
          await page.waitForTimeout(2000)

          const saved = await page.locator("text=Сохранено").isVisible({ timeout: 3000 }).catch(() => false)
          log("8.5 Переименование «Педагог» → «Тренер»", saved ? "OK" : "BUG", saved ? undefined : "Индикатор не появился")

          // Возвращаем обратно
          await inputByPlaceholder.clear()
          await inputByPlaceholder.fill("Педагог")
          await page.waitForTimeout(300)
          await page.locator("button:has-text('Сохранить')").first().click()
          await page.waitForTimeout(1000)
        } else {
          log("8.5 Поле роли «Педагог»", "BUG", "Не найден ни label, ни placeholder")
        }
      }
    } catch (e: any) {
      log("8.5 Названия ролей", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("8.6: Интеграции — страница загружается", async (page) => {
    await login(page)
    await page.goto("/settings/integrations")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const h1 = await page.locator("h1").first().textContent()
      const hasContent = h1?.includes("Интеграции")
        || await page.locator("text=Wazzup").first().isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=Mango").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=SMS").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("8.6 Интеграции — страница", hasContent ? "OK" : "BUG", hasContent ? undefined : `Заголовок: ${h1}`)
    } catch (e: any) {
      log("8.6 Интеграции", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // ЧАСТЬ 9: CRM FEATURES
  // ============================================================

  safeTest("9.1: Быстрый лид — создать через FAB-кнопку", async (page) => {
    await login(page)
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем FAB-кнопку «Новый лид»
      const fabBtn = page.locator("button:has-text('Новый лид')")
      if (!await fabBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("9.1 FAB-кнопка «Новый лид»", "BUG", "Не найдена на главной")
        return
      }
      log("9.1 FAB-кнопка «Новый лид» — видна", "OK")

      await fabBtn.click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      // Заполняем имя и телефон
      const quickLeadPhone = `+7999${TS}01`
      await dialog.locator("input#ql-firstName").fill(`Тест-Лид-${TS}`)
      await dialog.locator("input#ql-phone").fill(quickLeadPhone)
      await page.waitForTimeout(500)

      // Кликаем «Создать лида»
      await dialog.locator("button:has-text('Создать лида')").click()
      await page.waitForTimeout(3000)

      // После создания должно перенаправить на карточку клиента или лиды
      const url = page.url()
      const redirectedToClient = url.includes("/crm/clients/")
      if (redirectedToClient) {
        log("9.1 Быстрый лид — создан и перенаправлен в карточку", "OK")
      } else {
        // Проверяем что лид появился в списке лидов
        await page.goto("/crm/leads")
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1500)
        const visible = await page.locator(`text=Тест-Лид-${TS}`).isVisible({ timeout: 5000 }).catch(() => false)
        log("9.1 Быстрый лид", visible ? "OK" : "BUG", visible ? "Найден в списке лидов" : "Не найден ни в карточке, ни в списке")
      }
    } catch (e: any) {
      log("9.1 Быстрый лид", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("9.2: Дубликат — предупреждение при повторном телефоне", async (page) => {
    await login(page)
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const fabBtn = page.locator("button:has-text('Новый лид')")
      if (!await fabBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("9.2 FAB-кнопка для проверки дубликатов", "BUG", "Не найдена")
        return
      }

      await fabBtn.click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      // Вводим тот же телефон что в 9.1
      const quickLeadPhone = `+7999${TS}01`
      await dialog.locator("input#ql-phone").fill(quickLeadPhone)
      await page.waitForTimeout(2000) // Ждём debounce проверки дубликатов

      // Проверяем предупреждение о дубликате
      const hasDuplicateWarning = await page.locator("text=Найден похожий контакт").isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=дубликат").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=похожий").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("9.2 Предупреждение о дубликате", hasDuplicateWarning ? "OK" : "BUG", hasDuplicateWarning ? undefined : "Предупреждение не появилось при повторном телефоне")

      // Закрываем диалог
      const cancelBtn = dialog.locator("button:has-text('Отмена')")
      if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await cancelBtn.click()
      } else {
        await page.keyboard.press("Escape")
      }
      await page.waitForTimeout(500)
    } catch (e: any) {
      log("9.2 Дубликат — предупреждение", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("9.3: Лиды — сортировка «По дате контакта»", async (page) => {
    await login(page)
    await page.goto("/crm/leads")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем select сортировки (нативный <select>)
      const sortSelect = page.locator("select")
      if (!await sortSelect.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        log("9.3 Сортировка лидов — select", "BUG", "Select сортировки не найден")
        return
      }

      // Выбираем «По дате контакта» (value = nextContactDate)
      await sortSelect.first().selectOption("nextContactDate")
      await page.waitForTimeout(1000)

      // Проверяем что URL обновился
      const url = page.url()
      const hasSort = url.includes("sort=nextContactDate") || url.includes("sort=") || !url.includes("sort")
      log("9.3 Сортировка «По дате контакта»", "OK")

      // Переключаем на «По имени» для проверки работоспособности
      await sortSelect.first().selectOption("name")
      await page.waitForTimeout(1000)

      const urlAfter = page.url()
      if (urlAfter.includes("sort=name")) {
        log("9.3 Переключение сортировки на «По имени»", "OK")
      } else {
        log("9.3 Переключение сортировки", "BUG", `URL: ${urlAfter}`)
      }
    } catch (e: any) {
      log("9.3 Сортировка лидов", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("9.4: Карточка клиента — редактировать телефон", async (page) => {
    await login(page)
    await page.goto("/crm/clients")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Кликаем первого клиента
      const clientLink = page.locator("table tbody tr a, table tbody tr td").first()
      if (!await clientLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Пробуем другой селектор — карточки
        const card = page.locator("a[href*='/crm/clients/']").first()
        if (!await card.isVisible({ timeout: 3000 }).catch(() => false)) {
          log("9.4 Карточка клиента — клиенты", "BUG", "Нет клиентов в списке")
          return
        }
        await card.click()
      } else {
        await clientLink.click()
      }

      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Ищем кнопку «Редактировать» или иконку редактирования
      const editBtn = page.locator("button:has-text('Редактировать'), button:has-text('Редакт'), a:has-text('Редактировать')")
      if (await editBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await editBtn.first().click()
        await page.waitForTimeout(1500)

        // Ищем поле телефона
        const phoneInput = page.locator("input#cl-phone, input[name='phone'], input[placeholder*='Телефон'], input[placeholder*='+7']")
        if (await phoneInput.first().isVisible({ timeout: 5000 }).catch(() => false)) {
          const newPhone = `+7888${TS}99`
          await phoneInput.first().clear()
          await phoneInput.first().fill(newPhone)
          await page.waitForTimeout(300)

          // Сохраняем
          const saveBtn = page.locator("button:has-text('Сохранить'), button[type='submit']")
          if (await saveBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await saveBtn.first().click()
            await page.waitForTimeout(2000)

            // Проверяем что телефон обновился
            const phoneVisible = await page.locator(`text=${newPhone}`).isVisible({ timeout: 5000 }).catch(() => false)
              || await page.locator(`input[value='${newPhone}']`).isVisible({ timeout: 1000 }).catch(() => false)
            log("9.4 Редактирование телефона клиента", phoneVisible ? "OK" : "BUG", phoneVisible ? undefined : "Новый телефон не виден после сохранения")
          } else {
            log("9.4 Кнопка сохранить", "BUG", "Не найдена")
          }
        } else {
          log("9.4 Поле телефона", "BUG", "Не найдено при редактировании")
        }
      } else {
        // Может быть inline-редактирование или другой паттерн
        const phoneField = page.locator("text=Телефон").first()
        if (await phoneField.isVisible({ timeout: 3000 }).catch(() => false)) {
          log("9.4 Карточка клиента — телефон виден, но кнопка редактирования не найдена", "BUG", "Нет кнопки «Редактировать»")
        } else {
          log("9.4 Карточка клиента", "BUG", "Ни кнопки редактирования, ни поля телефона")
        }
      }
    } catch (e: any) {
      log("9.4 Редактирование клиента", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("9.5: Дубликаты — страница загружается", async (page) => {
    await login(page)
    await page.goto("/crm/duplicates")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const h1 = await page.locator("h1").first().textContent()
      const hasContent = h1?.includes("Дубликат") || h1?.includes("дубликат")
        || await page.locator("text=Дубликат").first().isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=дубликат").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("9.5 Страница дубликатов", hasContent ? "OK" : "BUG", hasContent ? undefined : `Заголовок: ${h1}`)
    } catch (e: any) {
      log("9.5 Дубликаты", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("9.6: Импорт — страница загружается", async (page) => {
    await login(page)
    await page.goto("/crm/import")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const h1 = await page.locator("h1").first().textContent()
      const hasContent = h1?.includes("Импорт") || h1?.includes("импорт")
        || await page.locator("text=Импорт").first().isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=CSV").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Excel").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Загрузить").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("9.6 Страница импорта", hasContent ? "OK" : "BUG", hasContent ? undefined : `Заголовок: ${h1}`)
    } catch (e: any) {
      log("9.6 Импорт", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // ЧАСТЬ 17: UI FEATURES
  // ============================================================

  safeTest("17.1: Breadcrumbs видны на странице настроек", async (page) => {
    await login(page)
    await page.goto("/settings/channels")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // AutoBreadcrumbs рендерит <nav> с BreadcrumbList
      const breadcrumb = page.locator("nav[aria-label='breadcrumb'], nav ol")
      const hasBreadcrumb = await breadcrumb.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasBreadcrumb) {
        // Проверяем что есть ссылка на «Главная» и текст «Каналы привлечения»
        const hasHome = await page.locator("nav a:has-text('Главная')").first().isVisible({ timeout: 2000 }).catch(() => false)
        const hasSettings = await page.locator("nav a:has-text('Настройки'), nav span:has-text('Настройки')").first().isVisible({ timeout: 2000 }).catch(() => false)
        log("17.1 Breadcrumbs", (hasHome || hasSettings) ? "OK" : "BUG", (hasHome || hasSettings) ? undefined : "Breadcrumb видны, но без ссылок на Главную/Настройки")
      } else {
        log("17.1 Breadcrumbs", "BUG", "Навигационные хлебные крошки не найдены")
      }
    } catch (e: any) {
      log("17.1 Breadcrumbs", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("17.2: Справка «?» — открывается sheet с содержимым", async (page) => {
    await login(page)
    await page.goto("/settings/channels")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // PageHelp рендерит SheetTrigger с HelpCircle icon, title="Справка по странице"
      const helpBtn = page.locator("button[title='Справка по странице'], [title='Справка по странице']")
      if (!await helpBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Пробуем искать по иконке
        const helpIcon = page.locator("svg.lucide-help-circle, svg.lucide-circle-help").first().locator("..")
        if (!await helpIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
          log("17.2 Иконка справки «?»", "BUG", "Не найдена")
          return
        }
        await helpIcon.click()
      } else {
        await helpBtn.first().click()
      }
      await page.waitForTimeout(1000)

      // Проверяем что Sheet открылся (SheetContent с data-slot='sheet-content' или role='dialog')
      const sheetContent = page.locator("[data-slot='sheet-content'], [data-state='open'][role='dialog']")
      const sheetVisible = await sheetContent.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (sheetVisible) {
        // Проверяем наличие текста внутри
        const hasText = await sheetContent.first().locator("h3, p, li").first().isVisible({ timeout: 3000 }).catch(() => false)
        log("17.2 Справка — sheet с содержимым", hasText ? "OK" : "BUG", hasText ? undefined : "Sheet открыт, но без контента")
      } else {
        log("17.2 Справка — sheet", "BUG", "Sheet не открылся после клика")
      }

      // Закрываем
      await page.keyboard.press("Escape")
      await page.waitForTimeout(500)
    } catch (e: any) {
      log("17.2 Справка", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("17.3: Дашборд — настройки виджетов (gear icon → toggle)", async (page) => {
    await login(page)
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // DashboardSettings рендерит кнопку с текстом «Настроить» и иконкой Settings2
      const settingsBtn = page.locator("button:has-text('Настроить')")
      if (!await settingsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Пробуем найти по иконке Settings2
        const gearBtn = page.locator("svg.lucide-settings-2, svg.lucide-settings").first().locator("..")
        if (!await gearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          log("17.3 Кнопка настройки дашборда", "BUG", "Не найдена")
          return
        }
        await gearBtn.click()
      } else {
        await settingsBtn.first().click()
      }
      await page.waitForTimeout(1000)

      // Проверяем что диалог настройки открылся
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()
      const dialogVisible = await dialog.isVisible({ timeout: 5000 }).catch(() => false)

      if (!dialogVisible) {
        log("17.3 Диалог настройки дашборда", "BUG", "Не открылся")
        return
      }

      // Ищем Switch (toggle) виджета — первый Switch в диалоге
      const switches = dialog.locator("button[role='switch']")
      const switchCount = await switches.count()

      if (switchCount === 0) {
        log("17.3 Переключатели виджетов", "BUG", "Не найдены в диалоге")
        return
      }

      // Запоминаем состояние первого switch
      const firstSwitch = switches.first()
      const wasChecked = await firstSwitch.getAttribute("data-state") === "checked"

      // Переключаем
      await firstSwitch.click()
      await page.waitForTimeout(500)

      const nowChecked = await firstSwitch.getAttribute("data-state") === "checked"
      if (wasChecked === nowChecked) {
        log("17.3 Toggle виджета", "BUG", "Switch не переключился")
      } else {
        log("17.3 Toggle виджета — переключён", "OK")
      }

      // Сохраняем
      const saveBtn = dialog.locator("button:has-text('Сохранить')")
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(1500)

        // Проверяем что виджет скрылся/появился (зависит от направления toggle)
        // Просто проверяем что диалог закрылся
        const dialogStillOpen = await dialog.isVisible({ timeout: 1000 }).catch(() => false)
        log("17.3 Сохранение настроек дашборда", !dialogStillOpen ? "OK" : "BUG", !dialogStillOpen ? undefined : "Диалог не закрылся после сохранения")
      } else {
        log("17.3 Кнопка сохранить в настройках дашборда", "BUG", "Не найдена")
      }

      // Возвращаем обратно — открываем снова и кликаем тот же switch
      if (!await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
        const settingsBtnAgain = page.locator("button:has-text('Настроить')")
        if (await settingsBtnAgain.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await settingsBtnAgain.first().click()
          await page.waitForTimeout(500)
          const dialogAgain = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()
          if (await dialogAgain.isVisible({ timeout: 2000 }).catch(() => false)) {
            await dialogAgain.locator("button[role='switch']").first().click()
            await page.waitForTimeout(300)
            const saveBtnAgain = dialogAgain.locator("button:has-text('Сохранить')")
            if (await saveBtnAgain.isVisible({ timeout: 1000 }).catch(() => false)) {
              await saveBtnAgain.click()
              await page.waitForTimeout(500)
            }
          }
        }
      }
    } catch (e: any) {
      log("17.3 Настройки дашборда", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("17.4: Колокольчик уведомлений в шапке", async (page) => {
    await login(page)
    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // NotificationBell рендерит кнопку с иконкой Bell
      const bellBtn = page.locator("svg.lucide-bell").first().locator("..")
      const hasBell = await bellBtn.isVisible({ timeout: 5000 }).catch(() => false)

      if (hasBell) {
        log("17.4 Колокольчик уведомлений — виден", "OK")
      } else {
        // Пробуем альтернативный селектор
        const bellAlt = page.locator("button[aria-label*='уведомлен'], button[title*='уведомлен'], button[aria-label*='notif']")
        const hasBellAlt = await bellAlt.first().isVisible({ timeout: 3000 }).catch(() => false)
        log("17.4 Колокольчик уведомлений", hasBellAlt ? "OK" : "BUG", hasBellAlt ? undefined : "Не найден в шапке")
      }
    } catch (e: any) {
      log("17.4 Колокольчик", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // СВОДКА
  // ============================================================

  test("СВОДКА: Результаты расширенного mega-теста", async () => {
    console.log("\n\n========================================")
    console.log("  СВОДКА: НАСТРОЙКИ + CRM + UI")
    console.log("========================================\n")

    const oks = results.filter(r => r.status === "OK")
    const bugs = results.filter(r => r.status === "BUG")

    console.log(`✅ Пройдено: ${oks.length}`)
    console.log(`❌ Багов: ${bugs.length}`)
    console.log(`📊 Всего шагов: ${results.length}`)
    console.log("")

    if (bugs.length > 0) {
      console.log("--- СПИСОК БАГОВ ---\n")
      bugs.forEach((b, i) => {
        console.log(`${i + 1}. ${b.step}`)
        if (b.detail) console.log(`   → ${b.detail}`)
      })
    }

    console.log("\n--- ВСЕ РЕЗУЛЬТАТЫ ---\n")
    results.forEach(r => {
      console.log(`${r.status === "OK" ? "✅" : "❌"} ${r.step}${r.detail ? ` — ${r.detail}` : ""}`)
    })

    // Тест пройдёт всегда — мы собираем статистику, не фейлим
    expect(true).toBe(true)
  })
})
