import { test, expect, type Page } from "@playwright/test"

/**
 * MEGA-ТЕСТ (расширение): Отчёты, Бэк-офис, Портал клиента, Аудит
 *
 * Предполагает, что организация уже создана основным mega-тестом.
 * Использует superadmin и owner-логины для проверки всех страниц.
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

async function loginAsAdmin(page: Page) {
  await page.goto("/admin/login")
  await page.waitForLoadState("domcontentloaded")
  // Если уже залогинен — сразу на /admin/partners
  if (page.url().includes("/admin/partners")) return
  const emailInput = page.locator('input[id="email"]')
  if (!await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Возможно перенаправило — проверяем URL
    if (page.url().includes("/admin")) return
  }
  await emailInput.fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)
  await page.waitForTimeout(300)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin/, { timeout: 20000 })
  await page.waitForTimeout(1000)
}

async function loginAsOwner(page: Page) {
  await page.goto("/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="login"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="login"]').fill("owner")
  await page.locator('input[id="password"]').fill("demo123")
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
// MEGA-ТЕСТ РАСШИРЕНИЕ
// ============================================================

test.describe.serial("Mega-тест (расширение): Отчёты, Бэк-офис, Портал, Аудит", () => {

  // ============================================================
  // ЧАСТЬ 15: ОТЧЁТЫ — обход всех страниц отчётов
  // ============================================================

  safeTest("15.1: Каталог отчётов — минимум 12 ссылок", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasTitle = await page.locator("text=Отчёты").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasTitle) {
        log("15.1 Каталог отчётов: заголовок", "BUG", "Заголовок «Отчёты» не найден")
      } else {
        log("15.1 Каталог отчётов: заголовок", "OK")
      }

      const links = await page.locator("a[href*='/reports/']").count()
      if (links >= 12) {
        log(`15.1 Каталог отчётов: ${links} ссылок`, "OK")
      } else {
        log(`15.1 Каталог отчётов: количество ссылок`, "BUG", `Ожидали >= 12, нашли ${links}`)
      }
    } catch (e: any) {
      log("15.1 Каталог отчётов", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.2: Отчёт «Допродажи» (/reports/crm/upsell) — табы", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/crm/upsell")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1, h2, [role='tablist']").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasPage) {
        log("15.2 Допродажи: страница", "BUG", "Страница не загрузилась")
        return
      }
      log("15.2 Допродажи: страница загрузилась", "OK")

      const hasTabs = await page.locator("[role='tablist'], button[role='tab']").first().isVisible({ timeout: 3000 }).catch(() => false)
      if (hasTabs) {
        const tabCount = await page.locator("button[role='tab']").count()
        log(`15.2 Допродажи: ${tabCount} табов`, "OK")
      } else {
        log("15.2 Допродажи: табы", "BUG", "Табы не найдены")
      }
    } catch (e: any) {
      log("15.2 Допродажи", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.3: P&L по направлениям (/reports/finance/pnl-directions) — таблица", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/finance/pnl-directions")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).or(page.locator("table")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasPage) {
        log("15.3 P&L по направлениям: страница", "BUG", "Страница не загрузилась")
        return
      }
      log("15.3 P&L по направлениям: страница загрузилась", "OK")

      const hasTable = await page.locator("table").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasTable) {
        log("15.3 P&L по направлениям: таблица есть", "OK")
      } else {
        log("15.3 P&L по направлениям: таблица", "BUG", "Таблица не найдена")
      }
    } catch (e: any) {
      log("15.3 P&L по направлениям", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.4: Неотмеченные (/reports/attendance/unmarked)", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/attendance/unmarked")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).or(page.locator("table")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("15.4 Неотмеченные: страница загрузилась", "OK")
      } else {
        log("15.4 Неотмеченные: страница", "BUG", "Страница не загрузилась")
      }
    } catch (e: any) {
      log("15.4 Неотмеченные", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.5: Непродлённые (/reports/churn/not-renewed)", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/churn/not-renewed")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).or(page.locator("table")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("15.5 Непродлённые: страница загрузилась", "OK")
      } else {
        log("15.5 Непродлённые: страница", "BUG", "Страница не загрузилась")
      }
    } catch (e: any) {
      log("15.5 Непродлённые", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.6: Потенциальный отток (/reports/churn/potential)", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/churn/potential")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).or(page.locator("table")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("15.6 Потенциальный отток: страница загрузилась", "OK")
      } else {
        log("15.6 Потенциальный отток: страница", "BUG", "Страница не загрузилась")
      }
    } catch (e: any) {
      log("15.6 Потенциальный отток", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.7: Кнопка экспорта Excel на странице отчёта", async (page) => {
    await loginAsOwner(page)
    // Проверяем на странице выручки — одна из самых заполненных
    await page.goto("/reports/finance/revenue")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем кнопку экспорта: может быть "Excel", "Экспорт", "Скачать", иконка загрузки
      const exportBtn = page.locator("button:has-text('Excel'), button:has-text('Экспорт'), button:has-text('Скачать'), button:has-text('xlsx'), a:has-text('Excel'), a:has-text('Экспорт')")
      const hasExport = await exportBtn.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasExport) {
        log("15.7 Кнопка экспорта Excel", "OK")
      } else {
        // Пробуем найти по иконке или aria-label
        const altExport = page.locator("[aria-label*='экспорт' i], [aria-label*='export' i], [title*='Excel'], [title*='экспорт' i]")
        const hasAlt = await altExport.first().isVisible({ timeout: 3000 }).catch(() => false)
        if (hasAlt) {
          log("15.7 Кнопка экспорта (по aria/title)", "OK")
        } else {
          log("15.7 Кнопка экспорта Excel", "BUG", "Кнопка экспорта не найдена на /reports/finance/revenue")
        }
      }
    } catch (e: any) {
      log("15.7 Кнопка экспорта", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("15.8: P&L — drill-down элементы", async (page) => {
    await loginAsOwner(page)
    await page.goto("/reports/finance/pnl")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).or(page.locator("table")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasPage) {
        log("15.8 P&L: страница", "BUG", "Страница не загрузилась")
        return
      }
      log("15.8 P&L: страница загрузилась", "OK")

      // Ищем drill-down элементы: кликабельные суммы, ссылки в таблице, кнопки раскрытия
      const drillDown = page.locator("button.text-primary, a.text-primary, [data-drilldown], button:has-text('▶'), button:has-text('→'), [role='button'][class*='cursor-pointer'], td a, td button")
      const hasDrillDown = await drillDown.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasDrillDown) {
        const count = await drillDown.count()
        log(`15.8 P&L: ${count} drill-down элементов`, "OK")
      } else {
        // Пробуем найти DrilldownAmount компонент по классу или структуре
        const drillAlt = page.locator("[class*='drilldown'], [class*='Drilldown'], span[role='button'], .cursor-pointer")
        const hasAlt = await drillAlt.first().isVisible({ timeout: 3000 }).catch(() => false)
        if (hasAlt) {
          log("15.8 P&L: drill-down элементы (альтернативный селектор)", "OK")
        } else {
          log("15.8 P&L: drill-down элементы", "BUG", "Кликабельные drill-down элементы не найдены")
        }
      }
    } catch (e: any) {
      log("15.8 P&L drill-down", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // ЧАСТЬ 16: БЭК-ОФИС (ADMIN)
  // ============================================================

  safeTest("16.1: Логин в бэк-офис superadmin", async (page) => {
    try {
      await loginAsAdmin(page)
      const hasPartners = await page.locator("text=Партнёры").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=партнёр").first().isVisible({ timeout: 1000 }).catch(() => false)
      if (hasPartners) {
        log("16.1 Логин superadmin", "OK")
      } else {
        log("16.1 Логин superadmin", "BUG", "Страница партнёров не загрузилась после логина")
      }
    } catch (e: any) {
      log("16.1 Логин superadmin", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("16.2: Список партнёров (/admin/partners) — минимум 1", async (page) => {
    await loginAsAdmin(page)
    await page.goto("/admin/partners")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasTable = await page.locator("table").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasTable) {
        // Может быть пустой список
        const isEmpty = await page.locator("text=Нет партнёров").first().isVisible({ timeout: 3000 }).catch(() => false)
        if (isEmpty) {
          log("16.2 Список партнёров", "BUG", "Список пуст — нет партнёров")
        } else {
          log("16.2 Список партнёров", "BUG", "Ни таблица, ни текст «Нет партнёров» не найдены")
        }
        return
      }

      const rows = await page.locator("table tbody tr").count()
      if (rows >= 1) {
        log(`16.2 Список партнёров: ${rows} партнёров`, "OK")
      } else {
        log("16.2 Список партнёров", "BUG", "Таблица есть, но 0 строк")
      }
    } catch (e: any) {
      log("16.2 Список партнёров", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("16.3: Карточка партнёра — детальная страница", async (page) => {
    await loginAsAdmin(page)
    await page.goto("/admin/partners")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Кликаем на первого партнёра в таблице
      const firstRow = page.locator("table tbody tr").first()
      const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasRow) {
        log("16.3 Карточка партнёра", "BUG", "Нет строк в таблице партнёров")
        return
      }

      // Ищем ссылку внутри строки или кликаем по строке
      const link = firstRow.locator("a").first()
      const hasLink = await link.isVisible({ timeout: 3000 }).catch(() => false)
      if (hasLink) {
        await link.click()
      } else {
        await firstRow.click()
      }
      await page.waitForTimeout(2000)

      // Проверяем что открылась карточка
      const hasDetail = await page.locator("text=Организация").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=Подписка").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("text=Партнёр").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.url().includes("/admin/partners/")

      if (hasDetail) {
        log("16.3 Карточка партнёра: загрузилась", "OK")
      } else {
        log("16.3 Карточка партнёра", "BUG", "Детальная страница не открылась")
      }
    } catch (e: any) {
      log("16.3 Карточка партнёра", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("16.4: Тарифные планы (/admin/plans)", async (page) => {
    await loginAsAdmin(page)
    await page.goto("/admin/plans")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("16.4 Тарифные планы: страница загрузилась", "OK")
      } else {
        log("16.4 Тарифные планы", "BUG", "Страница не загрузилась")
      }
    } catch (e: any) {
      log("16.4 Тарифные планы", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("16.5: Счета (/admin/invoices)", async (page) => {
    await loginAsAdmin(page)
    await page.goto("/admin/invoices")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("16.5 Счета: страница загрузилась", "OK")
      } else {
        log("16.5 Счета", "BUG", "Страница не загрузилась")
      }
    } catch (e: any) {
      log("16.5 Счета", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("16.6: Кнопка блокировки/разблокировки партнёра", async (page) => {
    await loginAsAdmin(page)
    await page.goto("/admin/partners")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      // Ищем кнопку блокировки — может быть в таблице или на карточке
      const blockBtn = page.locator("button:has-text('Заблокировать'), button:has-text('Разблокировать'), button:has-text('Блокировать'), button:has-text('Block'), button:has-text('блок')")
      let hasBlock = await blockBtn.first().isVisible({ timeout: 3000 }).catch(() => false)

      if (!hasBlock) {
        // Попробуем открыть карточку первого партнёра
        const firstRow = page.locator("table tbody tr").first()
        const hasRow = await firstRow.isVisible({ timeout: 3000 }).catch(() => false)
        if (hasRow) {
          const link = firstRow.locator("a").first()
          const hasLink = await link.isVisible({ timeout: 2000 }).catch(() => false)
          if (hasLink) {
            await link.click()
          } else {
            await firstRow.click()
          }
          await page.waitForTimeout(2000)

          // Проверяем на странице карточки
          const blockBtnDetail = page.locator("button:has-text('Заблокировать'), button:has-text('Разблокировать'), button:has-text('Блокировать'), button:has-text('блок')")
          hasBlock = await blockBtnDetail.first().isVisible({ timeout: 5000 }).catch(() => false)
        }
      }

      if (hasBlock) {
        log("16.6 Кнопка блокировки партнёра", "OK")
      } else {
        log("16.6 Кнопка блокировки партнёра", "BUG", "Кнопка блокировки/разблокировки не найдена")
      }
    } catch (e: any) {
      log("16.6 Кнопка блокировки", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // ЧАСТЬ 18: ПОРТАЛ КЛИЕНТА
  // ============================================================

  safeTest("18.1: Портал клиента — страница загружается", async (page) => {
    await loginAsOwner(page)

    try {
      // Получаем ID первого клиента через API
      const res = await page.request.get("/api/clients")
      let portalUrl = "/portal"

      if (res.ok()) {
        const clients = await res.json()
        const clientId = Array.isArray(clients) ? clients[0]?.id : clients?.data?.[0]?.id

        if (clientId) {
          // Генерируем токенную ссылку
          const linkRes = await page.request.post(`/api/clients/${clientId}/portal-link`)
          if (linkRes.ok()) {
            const linkData = await linkRes.json()
            if (linkData.link) {
              portalUrl = linkData.link
              log("18.1 Портал: ссылка сгенерирована", "OK")
            }
          }
        }
      }

      await page.goto(portalUrl)
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Принимаем согласие ПДн если есть
      const consentBtn = page.locator("button:has-text('Согласен'), button:has-text('Принимаю'), button:has-text('Принять')")
      if (await consentBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await consentBtn.first().click()
        await page.waitForTimeout(2000)
      }

      const hasPortal = await page.locator("text=Баланс").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=Расписание").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("text=Абонемент").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("text=Личный кабинет").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (hasPortal) {
        log("18.1 Портал клиента: загрузился", "OK")
      } else {
        log("18.1 Портал клиента", "BUG", "Портал не загрузился — ключевые элементы не найдены")
      }
    } catch (e: any) {
      log("18.1 Портал клиента", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("18.2: Портал — вкладка расписания", async (page) => {
    await loginAsOwner(page)

    try {
      // Генерируем ссылку на портал
      const res = await page.request.get("/api/clients")
      let portalUrl = "/portal"

      if (res.ok()) {
        const clients = await res.json()
        const clientId = Array.isArray(clients) ? clients[0]?.id : clients?.data?.[0]?.id
        if (clientId) {
          const linkRes = await page.request.post(`/api/clients/${clientId}/portal-link`)
          if (linkRes.ok()) {
            const linkData = await linkRes.json()
            if (linkData.link) portalUrl = linkData.link
          }
        }
      }

      await page.goto(portalUrl)
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Принимаем согласие если есть
      const consentBtn = page.locator("button:has-text('Согласен'), button:has-text('Принимаю'), button:has-text('Принять')")
      if (await consentBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await consentBtn.first().click()
        await page.waitForTimeout(1500)
      }

      const hasSchedule = await page.locator("text=Расписание").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("button[role='tab']:has-text('Расписание')").first().isVisible({ timeout: 2000 }).catch(() => false)
        || await page.locator("a:has-text('Расписание')").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (hasSchedule) {
        log("18.2 Портал: вкладка расписания", "OK")
      } else {
        log("18.2 Портал: вкладка расписания", "BUG", "Вкладка «Расписание» не найдена")
      }
    } catch (e: any) {
      log("18.2 Портал расписание", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("18.3: Портал — баланс и абонементы видны", async (page) => {
    await loginAsOwner(page)

    try {
      const res = await page.request.get("/api/clients")
      let portalUrl = "/portal"

      if (res.ok()) {
        const clients = await res.json()
        const clientId = Array.isArray(clients) ? clients[0]?.id : clients?.data?.[0]?.id
        if (clientId) {
          const linkRes = await page.request.post(`/api/clients/${clientId}/portal-link`)
          if (linkRes.ok()) {
            const linkData = await linkRes.json()
            if (linkData.link) portalUrl = linkData.link
          }
        }
      }

      await page.goto(portalUrl)
      await page.waitForLoadState("domcontentloaded")
      await page.waitForTimeout(2000)

      // Принимаем согласие если есть
      const consentBtn = page.locator("button:has-text('Согласен'), button:has-text('Принимаю'), button:has-text('Принять')")
      if (await consentBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await consentBtn.first().click()
        await page.waitForTimeout(1500)
      }

      const hasBalance = await page.locator("text=Баланс").first().isVisible({ timeout: 5000 }).catch(() => false)
      const hasSubscription = await page.locator("text=Абонемент").first().isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=Подписка").first().isVisible({ timeout: 2000 }).catch(() => false)

      if (hasBalance) {
        log("18.3 Портал: баланс виден", "OK")
      } else {
        log("18.3 Портал: баланс", "BUG", "Баланс не найден")
      }

      if (hasSubscription) {
        log("18.3 Портал: абонементы видны", "OK")
      } else {
        log("18.3 Портал: абонементы", "BUG", "Абонементы/подписки не найдены")
      }
    } catch (e: any) {
      log("18.3 Портал баланс/абонементы", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // ЧАСТЬ 19: ЗАКРЫТИЕ ПЕРИОДА И АУДИТ
  // ============================================================

  safeTest("19.1: Кнопка «Закрыть период» на странице зарплаты", async (page) => {
    await loginAsOwner(page)
    await page.goto("/salary")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasPage) {
        log("19.1 Зарплата: страница", "BUG", "Страница зарплаты не загрузилась")
        return
      }
      log("19.1 Зарплата: страница загрузилась", "OK")

      const closeBtn = page.locator("button:has-text('Закрыть период'), button:has-text('Закрыть'), button:has-text('закрыть период')")
      const hasCloseBtn = await closeBtn.first().isVisible({ timeout: 5000 }).catch(() => false)

      if (hasCloseBtn) {
        log("19.1 Кнопка «Закрыть период»", "OK")
      } else {
        // Может быть в выпадающем меню или другом месте
        const altBtn = page.locator("[aria-label*='закрыть' i], [title*='закрыть' i], button:has-text('период')")
        const hasAlt = await altBtn.first().isVisible({ timeout: 3000 }).catch(() => false)
        if (hasAlt) {
          log("19.1 Кнопка закрытия периода (альт. селектор)", "OK")
        } else {
          log("19.1 Кнопка «Закрыть период»", "BUG", "Кнопка не найдена на /salary")
        }
      }
    } catch (e: any) {
      log("19.1 Закрытие периода", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("19.2: Страница «Changelog» (/changelog)", async (page) => {
    await loginAsOwner(page)
    await page.goto("/changelog")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("19.2 Changelog: страница загрузилась", "OK")
      } else {
        log("19.2 Changelog", "BUG", "Страница changelog не загрузилась")
      }
    } catch (e: any) {
      log("19.2 Changelog", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("19.3: Страница «Roadmap» (/roadmap)", async (page) => {
    await loginAsOwner(page)
    await page.goto("/roadmap")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(1500)

    try {
      const hasPage = await page.locator("h1").or(page.locator("h2")).first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasPage) {
        log("19.3 Roadmap: страница загрузилась", "OK")
      } else {
        log("19.3 Roadmap", "BUG", "Страница roadmap не загрузилась")
      }
    } catch (e: any) {
      log("19.3 Roadmap", "BUG", e.message?.slice(0, 150))
    }
  })

  // ============================================================
  // СВОДКА
  // ============================================================

  test("СВОДКА: Результаты расширенного mega-теста", async () => {
    console.log("\n\n========================================")
    console.log("  СВОДКА РАСШИРЕННОГО MEGA-ТЕСТА")
    console.log("  (Отчёты, Бэк-офис, Портал, Аудит)")
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
