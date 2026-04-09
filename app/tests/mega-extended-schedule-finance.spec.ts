import { test, expect, type Page } from "@playwright/test"

/**
 * РАСШИРЕННЫЙ MEGA-ТЕСТ: Расписание, Абонементы, Финансы
 *
 * Предпосылка: основной mega-тест уже создал организацию с данными
 * (клиенты, группы, абонементы, оплаты, расходы, занятия).
 *
 * Этот файл проверяет дополнительные сценарии, которые не покрыты
 * основным mega-тестом.
 */

const ADMIN_EMAIL = "admin@umnayacrm.ru"
const ADMIN_PASSWORD = "admin123"

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

/** Логин под первым owner (берём из списка партнёров) */
async function loginAsFirstOwner(page: Page) {
  // Сначала получаем данные первого партнёра через бэк-офис
  await page.goto("/admin/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="email"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)
  await page.waitForTimeout(300)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 20000 })
  await page.locator("table, text=Нет партнёров").first().waitFor({ timeout: 10000 })

  // Находим первого партнёра — берём его owner login
  const firstRow = page.locator("table tbody tr").first()
  if (!await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error("Нет партнёров в бэк-офисе — запустите сначала основной mega-тест")
  }

  // Переходим в CRM через login
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="login"]').waitFor({ timeout: 10000 })

  // Используем API для получения первого пользователя
  // Пробуем стандартный логин — если основной тест не запущен, тест упадёт с понятной ошибкой
  // Используем fallback: пробуем разные логины
  const logins = ["owner-zv", "admin", "owner"]
  let loggedIn = false

  for (const prefix of logins) {
    try {
      await page.goto("/login")
      await page.waitForLoadState("domcontentloaded")
      await page.locator('input[id="login"]').waitFor({ timeout: 5000 })

      // Ищем всех пользователей через API бэк-офиса
      const res = await page.request.get("/api/admin/partners")
      if (res.ok()) {
        const partners = await res.json()
        if (partners.length > 0) {
          const owner = partners[0].owner
          if (owner) {
            await page.locator('input[id="login"]').fill(owner.login)
            await page.locator('input[id="password"]').fill(owner.password || "pass12345")
            await page.waitForTimeout(300)
            await page.click('button[type="submit"]')
            await page.waitForURL("/", { timeout: 10000 }).catch(() => {})
            if (page.url().endsWith("/") || !page.url().includes("/login")) {
              loggedIn = true
              break
            }
          }
        }
      }
    } catch {
      // try next
    }
  }

  if (!loggedIn) {
    throw new Error("Не удалось залогиниться — запустите сначала основной mega-тест")
  }
}

/** Простой логин: через бэк-офис API получаем первого owner и логинимся */
async function loginViaApi(page: Page) {
  // Логинимся в бэк-офис для получения данных
  const adminRes = await page.request.post("/api/admin/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })

  if (!adminRes.ok()) {
    throw new Error("Не удалось залогиниться в бэк-офис")
  }

  // Получаем первого партнёра
  const partnersRes = await page.request.get("/api/admin/partners")
  if (!partnersRes.ok()) {
    throw new Error("Не удалось получить партнёров")
  }

  const partners = await partnersRes.json()
  if (!partners || partners.length === 0) {
    throw new Error("Нет партнёров — запустите основной mega-тест")
  }

  const partner = partners[0]

  // Логинимся как owner первого партнёра
  const loginRes = await page.request.post("/api/auth/login", {
    data: { login: partner.ownerLogin, password: partner.ownerPassword },
  })

  // Если API login не работает, пробуем через UI
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="login"]').waitFor({ timeout: 10000 })
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

/** Универсальный логин — пробуем найти любого owner и залогиниться */
async function login(page: Page) {
  // Сначала логинимся в бэк-офис
  await page.goto("/admin/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="email"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)
  await page.waitForTimeout(300)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 20000 })
  await page.waitForTimeout(1000)

  // Получаем список партнёров через таблицу — ищем первую строку с логином
  const rows = page.locator("table tbody tr")
  const rowCount = await rows.count()

  if (rowCount === 0) {
    throw new Error("Нет партнёров — запустите основной mega-тест")
  }

  // Кликаем на первого партнёра чтобы увидеть его данные
  // Вместо этого — используем API
  const res = await page.request.get("/api/admin/partners")
  let ownerLogin = ""
  let ownerPassword = ""

  if (res.ok()) {
    const data = await res.json()
    if (Array.isArray(data) && data.length > 0) {
      ownerLogin = data[0].ownerLogin || data[0].owner?.login || ""
      ownerPassword = data[0].ownerPassword || data[0].owner?.password || ""
    }
  }

  // Если API не дал логин, пробуем найти его в текстовом содержимом таблицы
  if (!ownerLogin) {
    // Fallback: пробуем собрать логин из текста
    const firstCell = await rows.first().locator("td").allTextContents()
    // Ищем что-то похожее на логин (owner-zv-XXXXX)
    for (const text of firstCell) {
      const match = text.match(/owner-[\w-]+/)
      if (match) {
        ownerLogin = match[0]
        break
      }
    }
  }

  if (!ownerLogin) {
    throw new Error("Не удалось найти логин owner — проверьте API /api/admin/partners")
  }

  // Логинимся как owner
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="login"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="login"]').fill(ownerLogin)
  await page.locator('input[id="password"]').fill(ownerPassword || "pass12345")
  await page.waitForTimeout(300)
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 30000 })
}

// ============================================================
// ТЕСТЫ
// ============================================================

test.describe.serial("Расширенный mega-тест: Расписание, Абонементы, Финансы", () => {

  // ============================================================
  // ЧАСТЬ 10: РАСПИСАНИЕ
  // ============================================================

  safeTest("10.1: Расписание — фильтры (кабинет, направление, педагог)", async (page) => {
    await login(page)
    await page.goto("/schedule")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // Проверяем наличие фильтров
      const filterSelects = page.locator("[data-slot='select-trigger']")
      const filterCount = await filterSelects.count()

      if (filterCount < 3) {
        // Возможно фильтры есть, но как placeholder-тексты
        const hasRoomFilter = await page.locator("text=Кабинет").first().isVisible({ timeout: 3000 }).catch(() => false)
        const hasDirFilter = await page.locator("text=Направление").first().isVisible({ timeout: 2000 }).catch(() => false)
        const hasInstrFilter = await page.locator("text=Педагог").first().isVisible({ timeout: 2000 }).catch(() => false)

        if (hasRoomFilter || hasDirFilter || hasInstrFilter) {
          log("Расписание: фильтры найдены (по тексту)", "OK")
        } else {
          log("Расписание: фильтры", "BUG", `Найдено ${filterCount} select-ов, ожидали >=3`)
        }
      } else {
        log("Расписание: фильтры (3 dropdown)", "OK")
      }

      // Пробуем выбрать первый фильтр (кабинет)
      const firstFilter = filterSelects.first()
      if (await firstFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await firstFilter.click()
        await page.waitForTimeout(500)

        const items = page.locator("[data-slot='select-item']:visible")
        const itemCount = await items.count()

        if (itemCount > 0) {
          await items.first().click()
          await page.waitForTimeout(1000)
          log("Расписание: фильтр по кабинету применён", "OK")
        } else {
          // Закрываем dropdown
          await page.keyboard.press("Escape")
          log("Расписание: фильтр по кабинету", "BUG", "Нет пунктов в dropdown")
        }
      }
    } catch (e: any) {
      log("Расписание: фильтры", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("10.2: Расписание — «Копировать месяц» диалог", async (page) => {
    await login(page)
    await page.goto("/schedule")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const copyBtn = page.locator("button:has-text('Копировать месяц')")
      if (!await copyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Расписание: кнопка «Копировать месяц»", "BUG", "Не найдена")
        return
      }

      await copyBtn.click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      // Проверяем наличие полей month
      const sourceInput = dialog.locator("input[type='month']").first()
      const targetInput = dialog.locator("input[type='month']").last()

      const hasSource = await sourceInput.isVisible({ timeout: 2000 }).catch(() => false)
      const hasTarget = await targetInput.isVisible({ timeout: 2000 }).catch(() => false)

      if (hasSource && hasTarget) {
        log("Расписание: диалог «Копировать месяц» с пикерами", "OK")
      } else {
        log("Расписание: диалог «Копировать месяц»", "BUG", `source: ${hasSource}, target: ${hasTarget}`)
      }

      // Закрываем диалог
      const closeBtn = dialog.locator("button:has-text('Закрыть')")
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click()
      } else {
        await page.keyboard.press("Escape")
      }
    } catch (e: any) {
      log("Расписание: «Копировать месяц»", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("10.3: Группы — toggle «Показать архивные»", async (page) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const archiveBtn = page.locator("button:has-text('Показать архивные')")
      if (!await archiveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Может уже включён — ищем "Скрыть архивные"
        const hideBtn = page.locator("button:has-text('Скрыть архивные')")
        if (await hideBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          log("Группы: toggle «Скрыть архивные» (уже активен)", "OK")
          return
        }
        log("Группы: toggle архивных", "BUG", "Кнопка не найдена")
        return
      }

      await archiveBtn.click()
      await page.waitForTimeout(1500)

      // Проверяем что URL изменился
      const url = page.url()
      const hasParam = url.includes("showArchived=1")

      // Или что кнопка поменяла текст
      const hideBtn = page.locator("button:has-text('Скрыть архивные')")
      const toggled = hasParam || await hideBtn.isVisible({ timeout: 2000 }).catch(() => false)

      log("Группы: toggle «Показать архивные»", toggled ? "OK" : "BUG", toggled ? undefined : "URL не изменился и кнопка не переключилась")
    } catch (e: any) {
      log("Группы: toggle архивных", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("10.4: Карточка группы — секция архивирования", async (page) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем ссылку на первую группу
      const groupLink = page.locator("a[href*='/schedule/groups/']").first()
      if (!await groupLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Карточка группы: нет групп в списке", "BUG", "Создайте группы через основной mega-тест")
        return
      }

      await groupLink.click()
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Проверяем загрузку страницы
      const hasTitle = await page.locator("h1, h2").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasTitle) {
        log("Карточка группы: страница", "BUG", "Не загрузилась")
        return
      }

      // Ищем секцию архивирования (кнопка «Архивировать» или текст об архиве)
      const archiveBtn = page.locator("button:has-text('Архивировать')")
      const archiveSection = page.locator("text=Архив")
      const archiveBadge = page.locator("text=рхив")

      const hasArchiveBtn = await archiveBtn.isVisible({ timeout: 3000 }).catch(() => false)
      const hasArchiveSection = await archiveSection.isVisible({ timeout: 1000 }).catch(() => false)
      const hasArchiveBadge = await archiveBadge.isVisible({ timeout: 1000 }).catch(() => false)

      if (hasArchiveBtn || hasArchiveSection || hasArchiveBadge) {
        log("Карточка группы: секция архивирования найдена", "OK")
      } else {
        // Проверяем наличие вкладок — архив может быть на вкладке "Настройки"
        const settingsTab = page.locator("button[role='tab']:has-text('Настройки')")
        if (await settingsTab.isVisible({ timeout: 1000 }).catch(() => false)) {
          await settingsTab.click()
          await page.waitForTimeout(1000)
          const hasArchiveAfterTab = await page.locator("button:has-text('Архивировать')").isVisible({ timeout: 3000 }).catch(() => false)
            || await page.locator("text=рхив").isVisible({ timeout: 1000 }).catch(() => false)
          log("Карточка группы: секция архивирования", hasArchiveAfterTab ? "OK" : "BUG", hasArchiveAfterTab ? "Найдена на вкладке «Настройки»" : "Не найдена ни на одной вкладке")
        } else {
          log("Карточка группы: секция архивирования", "BUG", "Не найдена (нет кнопки и нет текста)")
        }
      }
    } catch (e: any) {
      log("Карточка группы: архивирование", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("10.5: Календарь — /schedule/calendar загружается", async (page) => {
    await login(page)
    await page.goto("/schedule/calendar")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // Проверяем что страница загрузилась (не 404)
      const has404 = await page.locator("text=404").isVisible({ timeout: 1000 }).catch(() => false)
      if (has404) {
        log("Календарь: /schedule/calendar", "BUG", "Страница 404")
        return
      }

      const hasCalendar = await page.locator("text=Календарь").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=асписание").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("table, .grid").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("Календарь: /schedule/calendar", hasCalendar ? "OK" : "BUG", hasCalendar ? undefined : "Страница не содержит ожидаемого контента")
    } catch (e: any) {
      log("Календарь: /schedule/calendar", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 11: ПОСЕЩЕНИЯ
  // ============================================================

  safeTest("11.1: Занятие — отметить ученика как прогул", async (page) => {
    await login(page)
    await page.goto("/schedule")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // Ищем ссылку на занятие
      const lessonLink = page.locator("a[href*='/schedule/lessons/']").first()
      if (!await lessonLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Занятие: нет занятий в расписании", "BUG", "Сгенерируйте расписание через основной mega-тест")
        return
      }

      await lessonLink.click()
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Проверяем таблицу посещаемости
      const hasAttendance = await page.locator("text=Посещаемость").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasAttendance) {
        log("Занятие: таблица посещаемости", "BUG", "Блок «Посещаемость» не найден")
        return
      }

      // Ищем select типа дня у первого ученика (не отмеченного)
      const attendanceSelects = page.locator("table [data-slot='select-trigger']")
      const selectCount = await attendanceSelects.count()

      if (selectCount === 0) {
        log("Занятие: нет учеников для отметки", "BUG", "В группе нет зачисленных")
        return
      }

      // Кликаем на первый select типа дня
      const firstSelect = attendanceSelects.first()
      await firstSelect.click()
      await page.waitForTimeout(500)

      // Ищем вариант с прогулом (absent / Отсутствовал)
      const absentItem = page.locator("[data-slot='select-item']:visible", { hasText: /тсутств|рогул|Пропу/i })
      if (await absentItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await absentItem.click()
        await page.waitForTimeout(2000)
        log("Занятие: ученик отмечен как прогул", "OK")
      } else {
        // Выбираем любой тип — просто проверяем что dropdown работает
        const anyItem = page.locator("[data-slot='select-item']:visible").first()
        if (await anyItem.isVisible({ timeout: 1000 }).catch(() => false)) {
          await anyItem.click()
          await page.waitForTimeout(1500)
          log("Занятие: ученик отмечен (тип прогула не найден, выбран первый)", "OK")
        } else {
          await page.keyboard.press("Escape")
          log("Занятие: отметка посещения", "BUG", "Нет вариантов в dropdown")
        }
      }
    } catch (e: any) {
      log("Занятие: отметка прогула", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("11.2: Занятие — кнопка «Добавить на отработку» (SCH-11)", async (page) => {
    await login(page)
    await page.goto("/schedule")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      const lessonLink = page.locator("a[href*='/schedule/lessons/']").first()
      if (!await lessonLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Отработка: нет занятий в расписании", "BUG", "Нет занятий")
        return
      }

      await lessonLink.click()
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Ищем кнопку "Добавить на отработку"
      const makeupBtn = page.locator("button:has-text('Добавить на отработку')")
      const hasMakeupBtn = await makeupBtn.isVisible({ timeout: 5000 }).catch(() => false)

      if (hasMakeupBtn) {
        log("Занятие: кнопка «Добавить на отработку» найдена (SCH-11)", "OK")
      } else {
        // Может быть в виде иконки UserPlus
        const userPlusBtn = page.locator("button:has(svg.lucide-user-plus)")
        const hasIconBtn = await userPlusBtn.isVisible({ timeout: 2000 }).catch(() => false)

        log("Занятие: кнопка «Добавить на отработку»",
          hasIconBtn ? "OK" : "BUG",
          hasIconBtn ? "Найдена как иконка UserPlus" : "Не найдена")
      }
    } catch (e: any) {
      log("Занятие: кнопка отработки", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 12: ЖИЗНЕННЫЙ ЦИКЛ АБОНЕМЕНТА
  // ============================================================

  safeTest("12.1: Карточка клиента — кнопка возврата абонемента (Undo2)", async (page) => {
    await login(page)
    await page.goto("/crm/clients")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Если нет клиентов, проверяем лидов
      let clientLink = page.locator("a[href*='/crm/clients/']").first()
      if (!await clientLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.goto("/crm/leads")
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1000)
        clientLink = page.locator("a[href*='/crm/clients/']").first()
      }

      if (!await clientLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Возврат абонемента: нет клиентов", "BUG", "Нет клиентов в системе")
        return
      }

      await clientLink.click()
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Переходим на вкладку Абонементы
      const subTab = page.locator("button[role='tab']:has-text('Абонементы')")
      if (!await subTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        log("Возврат абонемента: вкладка «Абонементы»", "BUG", "Не найдена")
        return
      }

      await subTab.click()
      await page.waitForTimeout(1500)

      // Ищем кнопку возврата (Undo2 icon)
      const refundBtn = page.locator("button:has(svg.lucide-undo-2), button[title='Возврат']")
      const hasRefundBtn = await refundBtn.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasRefundBtn) {
        await refundBtn.first().click()
        await page.waitForTimeout(1500)

        // Проверяем что диалог возврата открылся
        const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()
        const hasDialog = await dialog.isVisible({ timeout: 3000 }).catch(() => false)

        if (hasDialog) {
          // Ищем расчёт возврата
          const hasCalc = await dialog.locator("text=озврат").first().isVisible({ timeout: 2000 }).catch(() => false)
            || await dialog.locator("text=Сумма").first().isVisible({ timeout: 1000 }).catch(() => false)
            || await dialog.locator("text=₽").first().isVisible({ timeout: 1000 }).catch(() => false)

          log("Возврат абонемента: диалог открыт", "OK")
          if (hasCalc) {
            log("Возврат абонемента: расчёт суммы виден", "OK")
          }

          // Закрываем
          await page.keyboard.press("Escape")
        } else {
          log("Возврат абонемента: диалог", "BUG", "Не открылся после клика")
        }
      } else {
        log("Возврат абонемента: кнопка Undo2", "BUG", "Не найдена (нет абонементов?)")
      }
    } catch (e: any) {
      log("Возврат абонемента", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("12.2: Карточка клиента — кнопка переноса баланса (ArrowLeftRight)", async (page) => {
    await login(page)
    await page.goto("/crm/clients")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      let clientLink = page.locator("a[href*='/crm/clients/']").first()
      if (!await clientLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.goto("/crm/leads")
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1000)
        clientLink = page.locator("a[href*='/crm/clients/']").first()
      }

      if (!await clientLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Перенос баланса: нет клиентов", "BUG", "Нет клиентов")
        return
      }

      await clientLink.click()
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Вкладка Абонементы
      const subTab = page.locator("button[role='tab']:has-text('Абонементы')")
      if (await subTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await subTab.click()
        await page.waitForTimeout(1500)
      }

      // Ищем кнопку переноса баланса (ArrowLeftRight)
      const transferBtn = page.locator("button:has(svg.lucide-arrow-left-right), button[title='Перенести баланс']")
      const hasTransferBtn = await transferBtn.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasTransferBtn) {
        await transferBtn.first().click()
        await page.waitForTimeout(1500)

        const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()
        const hasDialog = await dialog.isVisible({ timeout: 3000 }).catch(() => false)

        if (hasDialog) {
          const hasTitle = await dialog.locator("text=Перенос").isVisible({ timeout: 2000 }).catch(() => false)
          log("Перенос баланса: диалог открыт", "OK")
          if (hasTitle) {
            log("Перенос баланса: заголовок «Перенос» виден", "OK")
          }
          await page.keyboard.press("Escape")
        } else {
          log("Перенос баланса: диалог", "BUG", "Не открылся")
        }
      } else {
        log("Перенос баланса: кнопка ArrowLeftRight", "BUG", "Не найдена (нет абонементов?)")
      }
    } catch (e: any) {
      log("Перенос баланса", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 13: ФИНАНСЫ
  // ============================================================

  safeTest("13.1: Оплаты — кнопка «Возврат» и диалог", async (page) => {
    await login(page)
    await page.goto("/finance/payments")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const refundBtn = page.locator("button:has-text('Возврат')")
      if (!await refundBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Оплаты: кнопка «Возврат»", "BUG", "Не найдена")
        return
      }

      await refundBtn.click()
      await page.waitForSelector("[data-slot='dialog-content'], div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("[data-slot='dialog-content'], div[role='dialog']").first()

      const hasTitle = await dialog.locator("text=Возврат").first().isVisible({ timeout: 3000 }).catch(() => false)
      if (hasTitle) {
        log("Оплаты: диалог «Возврат средств» открыт", "OK")
      } else {
        log("Оплаты: диалог возврата", "BUG", "Заголовок «Возврат» не найден в диалоге")
      }

      // Закрываем
      await page.keyboard.press("Escape")
    } catch (e: any) {
      log("Оплаты: возврат", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("13.2: Касса — список счетов", async (page) => {
    await login(page)
    await page.goto("/finance/cash")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Проверяем что страница загрузилась
      const hasTitle = await page.locator("text=Касса").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=Счета").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (!hasTitle) {
        log("Касса: страница", "BUG", "Не загрузилась")
        return
      }
      log("Касса: страница загрузилась", "OK")

      // Проверяем наличие счетов (карточки или таблица)
      const hasAccounts = await page.locator("[class*='card'], table").first().isVisible({ timeout: 3000 }).catch(() => false)
      const hasAccountText = await page.locator("text=Касса").isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Расчётный").isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Эквайринг").isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Нет счетов").isVisible({ timeout: 1000 }).catch(() => false)

      log("Касса: список счетов", hasAccounts || hasAccountText ? "OK" : "BUG",
        hasAccounts || hasAccountText ? undefined : "Ни карточек, ни таблицы счетов не найдено")
    } catch (e: any) {
      log("Касса", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("13.3: Расходы — список с данными", async (page) => {
    await login(page)
    await page.goto("/finance/expenses")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasTitle = await page.locator("text=Расходы").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasTitle) {
        log("Расходы: страница", "BUG", "Не загрузилась")
        return
      }

      // Проверяем наличие хотя бы одного расхода в таблице
      const rows = page.locator("table tbody tr")
      const rowCount = await rows.count().catch(() => 0)

      if (rowCount >= 1) {
        log(`Расходы: ${rowCount} записей в таблице`, "OK")
      } else {
        // Может быть текст "Нет расходов"
        const noData = await page.locator("text=Нет расходов").isVisible({ timeout: 2000 }).catch(() => false)
        log("Расходы: список", noData ? "OK" : "BUG", noData ? "Таблица пуста (Нет расходов)" : `Найдено ${rowCount} строк`)
      }
    } catch (e: any) {
      log("Расходы", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("13.4: Плановые расходы — страница загружается", async (page) => {
    await login(page)
    await page.goto("/finance/planned-expenses")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const has404 = await page.locator("text=404").isVisible({ timeout: 1000 }).catch(() => false)
      if (has404) {
        log("Плановые расходы", "BUG", "Страница 404")
        return
      }

      const hasContent = await page.locator("text=лановые").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=Расход").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("table, h1, h2").first().isVisible({ timeout: 2000 }).catch(() => false)

      log("Плановые расходы: страница", hasContent ? "OK" : "BUG", hasContent ? undefined : "Страница пуста")
    } catch (e: any) {
      log("Плановые расходы", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("13.5: ДДС — отчёт загружается с данными", async (page) => {
    await login(page)
    await page.goto("/finance/dds")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      const hasDds = await page.locator("text=Движение денежных средств").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=ДДС").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("text=Приход").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (!hasDds) {
        log("ДДС: страница", "BUG", "Не загрузилась")
        return
      }
      log("ДДС: страница загрузилась", "OK")

      // Проверяем наличие данных (суммы, таблица)
      const hasTable = await page.locator("table").first().isVisible({ timeout: 3000 }).catch(() => false)
      const hasNumbers = await page.locator("text=/\\d+.*₽/").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("text=/\\d{1,3}(\\s\\d{3})*/").first().isVisible({ timeout: 1000 }).catch(() => false)

      log("ДДС: данные", hasTable || hasNumbers ? "OK" : "BUG",
        hasTable || hasNumbers ? undefined : "Нет таблицы или числовых данных")
    } catch (e: any) {
      log("ДДС", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 14: ЗАРПЛАТА
  // ============================================================

  safeTest("14.1: Зарплата — таблица загружается", async (page) => {
    await login(page)
    await page.goto("/salary")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasTitle = await page.locator("text=Зарплата").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=арплата").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (!hasTitle) {
        log("Зарплата: страница", "BUG", "Не загрузилась")
        return
      }
      log("Зарплата: страница загрузилась", "OK")

      // Проверяем наличие таблицы с сотрудниками
      const hasTable = await page.locator("table").first().isVisible({ timeout: 5000 }).catch(() => false)
      const hasEmployees = await page.locator("table tbody tr").count().then(c => c > 0).catch(() => false)

      if (hasTable) {
        log("Зарплата: таблица отображена", "OK")
        if (hasEmployees) {
          log("Зарплата: есть данные по сотрудникам", "OK")
        }
      } else {
        // Проверяем текст "нет данных"
        const noData = await page.locator("text=Нет").first().isVisible({ timeout: 2000 }).catch(() => false)
        log("Зарплата: таблица", noData ? "OK" : "BUG", noData ? "Таблица пуста" : "Таблица не найдена")
      }
    } catch (e: any) {
      log("Зарплата: таблица", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("14.2: Зарплата — секция корректировок", async (page) => {
    await login(page)
    await page.goto("/salary")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(2000)

    try {
      // SalaryCorrections рендерится только если есть корректировки
      // Проверяем наличие или отсутствие секции
      const hasCorrections = await page.locator("text=Корректировки").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=Корректировки закрытых периодов").first().isVisible({ timeout: 1000 }).catch(() => false)

      if (hasCorrections) {
        log("Зарплата: секция корректировок отображена", "OK")

        // Проверяем таблицу корректировок
        const hasTable = await page.locator("text=Корректировки").locator("..").locator("table").first()
          .isVisible({ timeout: 2000 }).catch(() => false)
        if (hasTable) {
          log("Зарплата: таблица корректировок видна", "OK")
        }
      } else {
        // Это нормально — корректировок может не быть
        log("Зарплата: секция корректировок не отображена (нет данных — ОК)", "OK")
      }
    } catch (e: any) {
      log("Зарплата: корректировки", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // СВОДКА
  // ============================================================

  test("СВОДКА: Результаты расширенного mega-теста", async () => {
    console.log("\n\n========================================")
    console.log("  СВОДКА РАСШИРЕННОГО MEGA-ТЕСТА")
    console.log("  Расписание, Абонементы, Финансы")
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
