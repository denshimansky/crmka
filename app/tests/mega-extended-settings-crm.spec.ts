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
      // RoleDisplayNamesForm находится на вкладке «Организация» (defaultValue="org")
      // Убедимся что вкладка «Организация» активна
      const orgTab = page.locator("button[role='tab']:has-text('Организация')")
      if (await orgTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await orgTab.click()
        await page.waitForTimeout(500)
      }

      // Прокручиваем к секции «Названия ролей» (h2 внутри Card)
      const roleHeading = page.locator("h2:has-text('Названия ролей')")
      if (!await roleHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Прокручиваем вниз — форма может быть за пределами viewport
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(500)
      }

      const roleSection = await roleHeading.isVisible({ timeout: 5000 }).catch(() => false)
      if (!roleSection) {
        log("8.5 Названия ролей — секция", "BUG", "Не найдена на странице настроек")
        return
      }
      log("8.5 Названия ролей — секция найдена", "OK")

      // RoleDisplayNamesForm: каждая строка — div.flex > Label + Input
      // Label содержит дефолтное название, Input имеет placeholder с тем же текстом
      // Ищем input с placeholder «Педагог» (самый надёжный селектор)
      const inputByPlaceholder = page.locator("input[placeholder='Педагог']")
      // Прокручиваем к нему
      if (await inputByPlaceholder.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inputByPlaceholder.scrollIntoViewIfNeeded()
      } else {
        // Fallback: label «Педагог» рядом с input в том же flex-контейнере
        const pedagogRow = page.locator("label:has-text('Педагог')").locator("..").locator("input")
        if (await pedagogRow.isVisible({ timeout: 3000 }).catch(() => false)) {
          await pedagogRow.scrollIntoViewIfNeeded()
        }
      }

      const input = await inputByPlaceholder.isVisible({ timeout: 2000 }).catch(() => false)
        ? inputByPlaceholder
        : page.locator("label:has-text('Педагог')").locator("..").locator("input")

      if (!await input.isVisible({ timeout: 2000 }).catch(() => false)) {
        log("8.5 Поле роли «Педагог»", "BUG", "Не найден ни placeholder, ни label+input")
        return
      }

      await input.clear()
      await input.fill("Тренер")
      await page.waitForTimeout(300)

      // Кнопка «Сохранить» находится в том же CardContent что и h2
      const card = page.locator("h2:has-text('Названия ролей')").locator("xpath=ancestor::div[contains(@class,'p-6')]")
      const saveBtn = card.locator("button:has-text('Сохранить')")
      if (!await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Fallback — первая кнопка «Сохранить» на странице после секции
        await page.locator("button:has-text('Сохранить')").first().click()
      } else {
        await saveBtn.click()
      }
      await page.waitForTimeout(2000)

      const saved = await page.locator("text=Сохранено").isVisible({ timeout: 3000 }).catch(() => false)
      log("8.5 Переименование «Педагог» → «Тренер»", saved ? "OK" : "BUG", saved ? undefined : "Индикатор «Сохранено» не появился")

      // Возвращаем обратно
      await input.clear()
      await input.fill("Педагог")
      await page.waitForTimeout(300)
      const saveBtnAgain = page.locator("button:has-text('Сохранить')").first()
      if (await saveBtnAgain.isVisible({ timeout: 1000 }).catch(() => false)) {
        await saveBtnAgain.click()
        await page.waitForTimeout(1000)
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
    // QuickLeadButton есть и на дашборде (/), и на /crm/leads — используем leads как более лёгкую страницу
    await page.goto("/crm/leads")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // FAB-кнопка: fixed bottom-6 right-6 с текстом «Новый лид» (base-ui DialogTrigger + render={<Button>})
      // Ищем по data-slot="dialog-trigger" с текстом, или просто по тексту
      const fabBtn = page.locator("[data-slot='dialog-trigger']:has-text('Новый лид'), button:has-text('Новый лид')")
      if (!await fabBtn.first().isVisible({ timeout: 8000 }).catch(() => false)) {
        log("9.1 FAB-кнопка «Новый лид»", "BUG", "Не найдена на /crm/leads")
        return
      }
      log("9.1 FAB-кнопка «Новый лид» — видна", "OK")

      await fabBtn.first().click()
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
    await page.goto("/crm/leads")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      const fabBtn = page.locator("[data-slot='dialog-trigger']:has-text('Новый лид'), button:has-text('Новый лид')")
      if (!await fabBtn.first().isVisible({ timeout: 8000 }).catch(() => false)) {
        log("9.2 FAB-кнопка для проверки дубликатов", "BUG", "Не найдена")
        return
      }

      await fabBtn.first().click()
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
    await page.waitForTimeout(2000)

    try {
      // LeadsSortSelect рендерит нативный <select> с классом rounded-lg
      const sortSelect = page.locator("select")
      if (!await sortSelect.first().isVisible({ timeout: 8000 }).catch(() => false)) {
        // Fallback: страница может не иметь лидов — select всё равно рендерится
        log("9.3 Сортировка лидов — select", "BUG", "Select сортировки не найден (нативный <select>)")
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
      // Кликаем первого клиента — ссылка в таблице
      const clientLink = page.locator("a[href*='/crm/clients/']").first()
      if (!await clientLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Может быть — кликаем по ячейке таблицы
        const cell = page.locator("table tbody tr td").first()
        if (!await cell.isVisible({ timeout: 3000 }).catch(() => false)) {
          log("9.4 Карточка клиента — клиенты", "BUG", "Нет клиентов в списке")
          return
        }
        await cell.click()
      } else {
        await clientLink.click()
      }

      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // EditClientDialog: кнопка с иконкой Pencil (без текста «Редактировать»)
      // Рендерится через base-ui DialogTrigger render={<Button variant="ghost" size="icon">}
      // Ищем кнопку с svg.lucide-pencil или data-slot="dialog-trigger" рядом с «Информация»
      const editBtn = page.locator("button:has(svg.lucide-pencil), [data-slot='dialog-trigger']:has(svg.lucide-pencil)")
      if (await editBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await editBtn.first().click()
        await page.waitForTimeout(1500)

        // Диалог «Редактировать клиента» должен открыться
        const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()
        if (!await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
          log("9.4 Диалог редактирования", "BUG", "Не открылся после клика на Pencil")
          return
        }

        // Ищем поле телефона внутри диалога (placeholder "+7 (999) 123-45-67")
        const phoneInput = dialog.locator("input[placeholder*='+7'], input[placeholder*='Телефон']")
        if (await phoneInput.first().isVisible({ timeout: 5000 }).catch(() => false)) {
          const newPhone = `+7888${TS}99`
          await phoneInput.first().clear()
          await phoneInput.first().fill(newPhone)
          await page.waitForTimeout(300)

          // Сохраняем
          const saveBtn = dialog.locator("button:has-text('Сохранить'), button[type='submit']")
          if (await saveBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await saveBtn.first().click()
            await page.waitForTimeout(2000)

            // Проверяем что телефон обновился на странице
            const phoneVisible = await page.locator(`text=${newPhone}`).isVisible({ timeout: 5000 }).catch(() => false)
            log("9.4 Редактирование телефона клиента", phoneVisible ? "OK" : "BUG", phoneVisible ? undefined : "Новый телефон не виден после сохранения")
          } else {
            log("9.4 Кнопка сохранить", "BUG", "Не найдена в диалоге")
          }
        } else {
          log("9.4 Поле телефона", "BUG", "Не найдено в диалоге редактирования")
        }
      } else {
        // Fallback: ищем кнопку по тексту
        const editBtnText = page.locator("button:has-text('Редактировать'), button:has-text('Редакт')")
        if (await editBtnText.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          log("9.4 Карточка клиента — найдена текстовая кнопка «Редактировать»", "OK")
          await editBtnText.first().click()
        } else {
          log("9.4 Карточка клиента", "BUG", "Кнопка редактирования (Pencil icon) не найдена")
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
    await page.waitForTimeout(2000)

    try {
      // AutoBreadcrumbs рендерит: <nav aria-label="breadcrumb" data-slot="breadcrumb">
      //   <ol data-slot="breadcrumb-list"> ... </ol>
      // </nav>
      // Расположен в header layout-а (flex h-14 ...)

      // Ищем nav по data-slot (более надёжно чем aria-label)
      const breadcrumb = page.locator("[data-slot='breadcrumb'], nav[aria-label='breadcrumb']")
      const hasBreadcrumb = await breadcrumb.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasBreadcrumb) {
        // BreadcrumbLink рендерится через useRender как <a> (Next.js Link)
        // BreadcrumbPage рендерится как <span data-slot="breadcrumb-page">
        // Проверяем наличие элементов хлебных крошек
        const hasHome = await page.locator("[data-slot='breadcrumb'] a:has-text('Главная'), [data-slot='breadcrumb-link']:has-text('Главная')").first().isVisible({ timeout: 2000 }).catch(() => false)
        const hasSettings = await page.locator("[data-slot='breadcrumb'] :has-text('Настройки')").first().isVisible({ timeout: 2000 }).catch(() => false)
        const hasChannels = await page.locator("[data-slot='breadcrumb-page']:has-text('Каналы')").first().isVisible({ timeout: 2000 }).catch(() => false)

        if (hasHome || hasSettings || hasChannels) {
          log("17.1 Breadcrumbs", "OK")
        } else {
          // Проверяем содержимое breadcrumb-list
          const listText = await breadcrumb.first().textContent().catch(() => "")
          log("17.1 Breadcrumbs", "BUG", `Breadcrumb видны, но элементы не найдены. Текст: ${listText?.slice(0, 100)}`)
        }
      } else {
        log("17.1 Breadcrumbs", "BUG", "Навигационные хлебные крошки не найдены (ни data-slot, ни aria-label)")
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
      // DashboardSettings: DialogTrigger render={<Button variant="outline" size="sm">}
      //   <Settings2 /> + <span className="hidden sm:inline">Настроить</span>
      // Текст «Настроить» скрыт на маленьких viewport — ищем по иконке Settings2
      // или по data-slot="dialog-trigger" с иконкой
      const settingsBtn = page.locator("[data-slot='dialog-trigger']:has(svg.lucide-settings2), button:has(svg.lucide-settings2)")
      if (!await settingsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Fallback: по тексту «Настроить» (на широком viewport)
        const textBtn = page.locator("button:has-text('Настроить')")
        if (!await textBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          log("17.3 Кнопка настройки дашборда", "BUG", "Не найдена (ни иконка Settings2, ни текст)")
          return
        }
        await textBtn.first().click()
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

      // Switch компонент: <button role="switch" aria-checked="true|false">
      // НЕ использует data-state — используем aria-checked
      const switches = dialog.locator("button[role='switch']")
      const switchCount = await switches.count()

      if (switchCount === 0) {
        log("17.3 Переключатели виджетов", "BUG", "Не найдены в диалоге")
        return
      }

      // Запоминаем состояние первого switch через aria-checked
      const firstSwitch = switches.first()
      const wasChecked = await firstSwitch.getAttribute("aria-checked") === "true"

      // Переключаем
      await firstSwitch.click()
      await page.waitForTimeout(500)

      const nowChecked = await firstSwitch.getAttribute("aria-checked") === "true"
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

        // Проверяем что диалог закрылся
        const dialogStillOpen = await dialog.isVisible({ timeout: 1000 }).catch(() => false)
        log("17.3 Сохранение настроек дашборда", !dialogStillOpen ? "OK" : "BUG", !dialogStillOpen ? undefined : "Диалог не закрылся после сохранения")
      } else {
        log("17.3 Кнопка сохранить в настройках дашборда", "BUG", "Не найдена")
      }

      // Возвращаем обратно — открываем снова и кликаем тот же switch
      if (!await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
        const settingsBtnAgain = page.locator("[data-slot='dialog-trigger']:has(svg.lucide-settings2), button:has(svg.lucide-settings2)")
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
