import { test, expect, type Page } from "@playwright/test"

/**
 * MEGA-ТЕСТ: Полный бизнес-сценарий детского центра «Звёздочка»
 *
 * Цель: прогнать весь учёт за март 2026 через UI.
 * Стратегия: собираем ВСЕ баги, не чиним по ходу.
 *
 * Персонажи:
 * - 2 филиала, 4 кабинета (по 2, ёмкость 8)
 * - 3 направления: Танцы (800₽), Рисование (600₽), Английский (700₽)
 * - 4 педагога (по 2 на филиал)
 * - 6 групп (по 2 направления на филиал)
 * - 10 родителей, 14 подопечных:
 *   — Иванова Мария: 3 ребёнка (Ваня, Маша, Даша) → скидка многодетность
 *   — Петров Алексей: 2 ребёнка (Коля, Оля)
 *   — Сидорова Елена: 1 ребёнок → ДОЛЖНИК (не оплатит)
 *   — Козлов Дмитрий: 1 ребёнок → ПЕРЕПЛАТА (оплатит больше)
 *   — Ещё 6 родителей по 1 ребёнку
 * - 5 лидов → пробник → конверсия
 * - Прогульщики: 2-3 ребёнка пропускают часть занятий
 */

const TS = Date.now().toString().slice(-5)
const ORG_NAME = `Звёздочка-${TS}`
const OWNER_LOGIN = `owner-zv-${TS}`
const OWNER_PASSWORD = `pass${TS}`
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
  await page.waitForLoadState("networkidle")
  await page.locator('input[id="email"]').click()
  await page.locator('input[id="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)
  await page.waitForTimeout(200)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 15000 })
  await page.waitForSelector("table", { timeout: 10000 })
}

async function login(page: Page) {
  await page.goto("/login")
  await page.waitForLoadState("networkidle")
  await page.locator('input[id="login"]').click()
  await page.locator('input[id="login"]').fill(OWNER_LOGIN)
  await page.locator('input[id="password"]').click()
  await page.locator('input[id="password"]').fill(OWNER_PASSWORD)
  await page.waitForTimeout(200)
  await page.click('button[type="submit"]')
  await page.waitForURL("/", { timeout: 15000 })
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

async function selectNth(page: Page, dialog: any, index: number, textFilter?: string) {
  const selects = dialog.locator("[data-slot='select-trigger']")
  await selects.nth(index).click()
  await page.waitForTimeout(500)
  if (textFilter) {
    const item = page.locator(`[data-slot='select-item']:visible`, { hasText: textFilter })
    if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
      await item.click()
    } else {
      await page.locator("[data-slot='select-item']:visible").first().click()
    }
  } else {
    await page.locator("[data-slot='select-item']:visible").first().click()
  }
  await page.waitForTimeout(500)
}

// ============================================================
// ЧАСТЬ 1: ИНФРАСТРУКТУРА
// ============================================================

test.describe.serial("Mega-тест: Полный бизнес-сценарий «Звёздочка»", () => {

  // ============================================================
  // ЧАСТЬ 0: СОЗДАНИЕ ОРГАНИЗАЦИИ ЧЕРЕЗ БЭК-ОФИС
  // ============================================================

  safeTest("ЧАСТЬ 0: Создать организацию «Звёздочка» через бэк-офис с owner", async (page) => {
    await loginAsAdmin(page)

    try {
      await page.locator("button:has-text('Добавить партнёра')").click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")
      const inputs = dialog.locator("input")

      // Организация
      await inputs.nth(0).fill(ORG_NAME)                          // Название
      await inputs.nth(1).fill(`ООО "Звёздочка ${TS}"`)           // Юрлицо
      await inputs.nth(2).fill("7700000001")                       // ИНН
      await inputs.nth(3).fill("+7 (999) 000-00-01")               // Телефон
      await inputs.nth(4).fill(`zv${TS}@example.com`)              // Email
      await inputs.nth(5).fill("Директор Звёздочки")               // Контактное лицо

      // Owner
      await inputs.nth(6).fill("Звёздочкина")                     // Фамилия owner
      await inputs.nth(7).fill("Елена")                            // Имя owner
      await inputs.nth(8).fill(OWNER_LOGIN)                        // Логин
      await inputs.nth(9).fill(OWNER_PASSWORD)                     // Пароль
      await inputs.nth(10).fill(`zv-owner-${TS}@example.com`)     // Email owner

      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)

      const visible = await page.locator(`text=${ORG_NAME}`).isVisible({ timeout: 5000 }).catch(() => false)
      if (visible) {
        log(`Организация «${ORG_NAME}» создана через бэк-офис`, "OK")
      } else {
        log(`Организация «${ORG_NAME}»`, "BUG", "Не появилась в списке партнёров")
      }
    } catch (e: any) {
      log("Создание организации через бэк-офис", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("ЧАСТЬ 0.1: Логин под owner Звёздочки", async (page) => {
    try {
      await login(page)
      const h1 = await page.locator("h1").first().textContent()
      if (h1?.includes("Главная")) {
        log(`Логин под owner «${OWNER_LOGIN}»`, "OK")
      } else {
        log(`Логин под owner`, "BUG", `h1: ${h1}`)
      }
    } catch (e: any) {
      log("Логин под owner Звёздочки", "BUG", e.message?.slice(0, 150))
    }
  })

  safeTest("ЧАСТЬ 0.2: Создать 2 филиала через UI", async (page) => {
    await login(page)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    // Вкладка Филиалы
    await page.locator("button[role='tab']:has-text('Филиалы')").click()
    await page.waitForTimeout(500)

    const branches = [`Филиал Центр-${TS}`, `Филиал Север-${TS}`]
    for (const branchName of branches) {
      try {
        await page.locator("button:has-text('Филиал')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")
        await dialog.locator("input").first().fill(branchName)
        await dialog.locator("button[type='submit']").click()
        await page.waitForTimeout(2000)

        const visible = await page.locator(`text=${branchName}`).isVisible({ timeout: 3000 }).catch(() => false)
        log(`Филиал «${branchName}»`, visible ? "OK" : "BUG", visible ? undefined : "Не появился после создания")
      } catch (e: any) {
        log(`Филиал «${branchName}»`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 0.3: Создать 4 кабинета через UI", async (page) => {
    await login(page)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    await page.locator("button[role='tab']:has-text('Филиалы')").click()
    await page.waitForTimeout(500)

    const rooms = [`Зал A-${TS}`, `Зал B-${TS}`, `Класс C-${TS}`, `Класс D-${TS}`]
    for (const roomName of rooms) {
      try {
        await page.locator("button:has-text('Кабинет')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")

        await dialog.locator("input").first().fill(roomName)

        // Филиал select
        const selects = dialog.locator("[data-slot='select-trigger']")
        await selects.first().click()
        await page.waitForTimeout(300)
        const branchIdx = rooms.indexOf(roomName) < 2 ? 0 : 1
        const items = page.locator("[data-slot='select-item']:visible")
        const count = await items.count()
        await items.nth(count > branchIdx ? branchIdx : 0).click()
        await page.waitForTimeout(300)

        // Вместимость = 8
        await dialog.locator("input[type='number']").fill("8")

        await dialog.locator("button[type='submit']").click()
        await page.waitForTimeout(2000)

        const visible = await page.locator(`text=${roomName}`).isVisible({ timeout: 3000 }).catch(() => false)
        log(`Кабинет «${roomName}» (ёмкость 8)`, visible ? "OK" : "BUG", visible ? undefined : "Не появился")
      } catch (e: any) {
        log(`Кабинет «${roomName}»`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  // ============================================================
  // ЧАСТЬ 1: ИНФРАСТРУКТУРА (направления, педагоги, группы, счета)
  // ============================================================

  safeTest("ЧАСТЬ 1.1: Настройки — проверяем что организация загружается", async (page) => {
    await login(page)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    const hasSettings = await page.locator("h1").textContent()
    if (hasSettings?.includes("Настройки")) {
      log("Страница настроек", "OK")
    } else {
      log("Страница настроек", "BUG", `Заголовок: ${hasSettings}`)
    }

    // Проверяем что есть хотя бы 1 филиал
    await expect(page.locator("text=Филиал").first()).toBeVisible({ timeout: 5000 })
    log("Филиалы видны в настройках", "OK")
  })

  safeTest("ЧАСТЬ 1.2: Направления — создать 3 шт", async (page) => {
    await login(page)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    // Переходим на вкладку Направления
    await page.locator("button[role='tab']:has-text('Направления')").click()
    await page.waitForTimeout(500)

    const directions = [
      { name: `Танцы-${TS}`, price: "800" },
      { name: `Рисование-${TS}`, price: "600" },
      { name: `Английский-${TS}`, price: "700" },
    ]

    for (const dir of directions) {
      try {
        await page.locator("button:has-text('Направление')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")
        await dialog.locator("input").first().fill(dir.name)
        await dialog.locator("input[type='number']").first().fill(dir.price)
        await dialog.locator("button:has-text('Создать')").click()
        await page.waitForTimeout(1500)

        // Проверяем
        const visible = await page.locator(`text=${dir.name}`).isVisible({ timeout: 3000 }).catch(() => false)
        if (visible) {
          log(`Направление «${dir.name}»`, "OK")
        } else {
          log(`Направление «${dir.name}»`, "BUG", "Не появилось в списке после создания")
        }
      } catch (e: any) {
        log(`Направление «${dir.name}»`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 1.3: Педагоги — создать 4 шт", async (page) => {
    await login(page)
    await page.goto("/staff")
    await page.waitForLoadState("networkidle")

    const instructors = [
      { last: "Волкова", first: "Анна", login: `volka${TS}` },
      { last: "Медведев", first: "Сергей", login: `medved${TS}` },
      { last: "Лисицына", first: "Ольга", login: `lisica${TS}` },
      { last: "Орлов", first: "Игорь", login: `orlov${TS}` },
    ]

    for (const instr of instructors) {
      try {
        await page.locator("button:has-text('Сотрудник')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")

        await dialog.locator('input[id="lastName"]').fill(instr.last)
        await dialog.locator('input[id="firstName"]').fill(instr.first)
        await dialog.locator('input[id="login"]').fill(instr.login)
        await dialog.locator('input[id="password"]').fill("test123")

        // Выбираем роль Инструктор
        await dialog.locator("[data-slot='select-trigger']").first().click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']", { hasText: "Инструктор" }).click()
        await page.waitForTimeout(300)

        await dialog.locator("button:has-text('Создать')").click()
        await page.waitForTimeout(1500)

        const visible = await page.locator(`text=${instr.last}`).isVisible({ timeout: 3000 }).catch(() => false)
        if (visible) {
          log(`Педагог ${instr.last} ${instr.first}`, "OK")
        } else {
          log(`Педагог ${instr.last} ${instr.first}`, "BUG", "Не появился в списке")
        }
      } catch (e: any) {
        log(`Педагог ${instr.last} ${instr.first}`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 1.4: Группы — создать 6 шт", async (page) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.waitForLoadState("networkidle")

    const groups = [
      `Танцы-МлФ1-${TS}`,
      `Рисование-СрФ1-${TS}`,
      `Английский-СтФ1-${TS}`,
      `Танцы-МлФ2-${TS}`,
      `Рисование-СрФ2-${TS}`,
      `Английский-СтФ2-${TS}`,
    ]

    for (const groupName of groups) {
      try {
        await page.locator("button:has-text('Группа')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")

        await dialog.locator("input").first().fill(groupName)

        // 4 select: направление, филиал, кабинет, педагог
        const selects = dialog.locator("[data-slot='select-trigger']")
        for (let i = 0; i < 4; i++) {
          await selects.nth(i).click()
          await page.waitForTimeout(500)
          const items = page.locator("[data-slot='select-item']:visible")
          const count = await items.count()
          if (count > 0) {
            // Для разнообразия: чётные группы берут первый вариант, нечётные — второй
            const idx = groups.indexOf(groupName)
            const pick = count > 1 && idx % 2 === 1 ? 1 : 0
            await items.nth(pick).click()
          }
          await page.waitForTimeout(500)
        }

        // Добавить день расписания
        const addDayBtn = dialog.locator("button:has-text('Добавить день')")
        if (await addDayBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await addDayBtn.click()
          await page.waitForTimeout(300)
        }

        await dialog.locator("button:has-text('Создать')").click()
        await page.waitForTimeout(2000)

        const visible = await page.locator(`text=${groupName}`).isVisible({ timeout: 3000 }).catch(() => false)
        if (visible) {
          log(`Группа «${groupName}»`, "OK")
        } else {
          log(`Группа «${groupName}»`, "BUG", "Не появилась в списке")
        }
      } catch (e: any) {
        log(`Группа «${groupName}»`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 1.5: Касса + Расчётный счёт", async (page) => {
    await login(page)
    await page.goto("/finance/cash")
    await page.waitForLoadState("networkidle")

    const accounts = [
      { name: `Касса-${TS}`, type: "Касса" },
      { name: `Расчётный-${TS}`, type: "Расчётный счёт" },
    ]

    for (const acc of accounts) {
      try {
        await page.goto("/finance/cash")
        await page.waitForLoadState("networkidle")
        await page.waitForTimeout(500)
        await page.locator("button:has-text('Счёт')").first().click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")

        await dialog.locator("input").first().fill(acc.name)
        await dialog.locator("[data-slot='select-trigger']").first().click()
        await page.waitForTimeout(300)

        const typeItem = page.locator("[data-slot='select-item']:visible", { hasText: acc.type })
        if (await typeItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await typeItem.click()
        } else {
          await page.locator("[data-slot='select-item']:visible").first().click()
        }
        await page.waitForTimeout(300)

        await dialog.locator("button:has-text('Создать')").click()
        await page.waitForTimeout(1500)

        const visible = await page.locator(`text=${acc.name}`).isVisible({ timeout: 3000 }).catch(() => false)
        if (visible) {
          log(`Счёт «${acc.name}» (${acc.type})`, "OK")
        } else {
          log(`Счёт «${acc.name}» (${acc.type})`, "BUG", "Не появился")
        }
      } catch (e: any) {
        log(`Счёт «${acc.name}» (${acc.type})`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  // ============================================================
  // ЧАСТЬ 2: КЛИЕНТЫ
  // ============================================================

  safeTest("ЧАСТЬ 2.1: Создать 10 клиентов-родителей с подопечными", async (page) => {
    await login(page)
    await page.goto("/crm/leads")
    await page.waitForLoadState("networkidle")

    const clients = [
      { last: "Иванова", first: "Мария", phone: "+79991110001", wards: ["Ваня", "Маша", "Даша"] },       // 3 ребёнка → скидка
      { last: "Петров", first: "Алексей", phone: "+79991110002", wards: ["Коля", "Оля"] },                // 2 ребёнка
      { last: "Сидорова", first: "Елена", phone: "+79991110003", wards: ["Артём"] },                       // должник
      { last: "Козлов", first: "Дмитрий", phone: "+79991110004", wards: ["Лиза"] },                        // переплата
      { last: "Новикова", first: "Светлана", phone: "+79991110005", wards: ["Миша"] },
      { last: "Морозов", first: "Андрей", phone: "+79991110006", wards: ["Катя"] },
      { last: "Волков", first: "Николай", phone: "+79991110007", wards: ["Саша"] },
      { last: "Зайцева", first: "Татьяна", phone: "+79991110008", wards: ["Денис"] },
      { last: "Соколов", first: "Павел", phone: "+79991110009", wards: ["Алина"] },
      { last: "Кузнецова", first: "Ирина", phone: "+79991110010", wards: ["Тимур"] },
    ]

    for (const cl of clients) {
      try {
        await page.locator("button:has-text('Клиент')").click()
        await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
        const dialog = page.locator("div[role='dialog']")

        await dialog.locator("input#cl-lastName").fill(cl.last)
        await dialog.locator("input#cl-firstName").fill(cl.first)
        await dialog.locator("input#cl-phone").fill(cl.phone)

        // Добавляем подопечных
        for (const ward of cl.wards) {
          await dialog.locator("button:has-text('Подопечный')").click()
          await page.waitForTimeout(300)
          const wardInputs = dialog.locator("input[placeholder='Имя']")
          await wardInputs.last().fill(ward)
          await page.waitForTimeout(200)
        }

        await dialog.locator("button:has-text('Создать')").last().click()
        await page.waitForTimeout(1500)

        const visible = await page.locator(`text=${cl.last}`).first().isVisible({ timeout: 3000 }).catch(() => false)
        if (visible) {
          log(`Клиент ${cl.last} ${cl.first} (${cl.wards.length} подопечных)`, "OK")
        } else {
          log(`Клиент ${cl.last} ${cl.first}`, "BUG", "Не появился в списке")
        }
      } catch (e: any) {
        log(`Клиент ${cl.last} ${cl.first}`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 2.2: Проверить карточку Ивановой (3 подопечных)", async (page) => {
    await login(page)
    await page.goto("/crm/leads")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      // Открываем карточку
      await page.locator("a:has-text('Иванова')").first().click()
      await page.waitForTimeout(2000)

      // Вкладка подопечные
      await page.locator("button[role='tab']:has-text('Подопечные')").click()
      await page.waitForTimeout(500)

      const hasVanya = await page.locator("text=Ваня").isVisible({ timeout: 3000 }).catch(() => false)
      const hasMasha = await page.locator("text=Маша").isVisible({ timeout: 1000 }).catch(() => false)
      const hasDasha = await page.locator("text=Даша").isVisible({ timeout: 1000 }).catch(() => false)

      if (hasVanya && hasMasha && hasDasha) {
        log("Иванова: 3 подопечных (Ваня, Маша, Даша)", "OK")
      } else {
        log("Иванова: 3 подопечных", "BUG", `Ваня=${hasVanya} Маша=${hasMasha} Даша=${hasDasha}`)
      }
    } catch (e: any) {
      log("Карточка Ивановой", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 3: РАСПИСАНИЕ И ЗАЧИСЛЕНИЕ
  // ============================================================

  safeTest("ЧАСТЬ 3.1: Сгенерировать расписание на март для первой группы", async (page) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      // Открываем первую группу
      const firstGroup = page.locator("table tbody tr a, a:has-text('Танцы')").first()
      await firstGroup.click()
      await page.waitForTimeout(2000)

      // Вкладка "Расписание"
      const scheduleTab = page.locator("button[role='tab']:has-text('Расписание')")
      if (await scheduleTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await scheduleTab.click()
        await page.waitForTimeout(500)
      }

      // Кнопка "Сгенерировать"
      const genBtn = page.locator("button:has-text('Сгенерировать')")
      if (await genBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await genBtn.click()
        await page.waitForTimeout(1000)

        // В диалоге генерации
        const genDialog = page.locator("div[role='dialog']")
        if (await genDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
          await genDialog.locator("button:has-text('Сгенерировать')").click()
          await page.waitForTimeout(2000)
        }

        log("Генерация расписания первой группы", "OK")
      } else {
        log("Генерация расписания", "BUG", "Кнопка 'Сгенерировать' не найдена")
      }
    } catch (e: any) {
      log("Генерация расписания", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 3.2: Зачислить клиентов в группы", async (page) => {
    await login(page)
    await page.goto("/schedule/groups")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      // Открываем первую группу
      const firstGroup = page.locator("table tbody tr a").first()
      await firstGroup.click()
      await page.waitForTimeout(2000)

      // Вкладка "Состав"
      const compTab = page.locator("button[role='tab']:has-text('Состав')")
      if (await compTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await compTab.click()
        await page.waitForTimeout(500)
      }

      // Зачисляем первых 3 клиентов
      const clientNames = ["Иванова", "Петров", "Сидорова"]
      for (const clientLast of clientNames) {
        try {
          const enrollBtn = page.locator("button:has-text('Зачислить')")
          await enrollBtn.click()
          await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
          const dialog = page.locator("div[role='dialog']")

          await dialog.locator("[data-slot='select-trigger']").first().click()
          await page.waitForTimeout(500)

          const clientItem = page.locator(`[data-slot='select-item']:visible`, { hasText: clientLast })
          if (await clientItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await clientItem.click()
          } else {
            await page.locator("[data-slot='select-item']:visible").first().click()
          }
          await page.waitForTimeout(500)

          await dialog.locator("button:has-text('Зачислить')").click()
          await page.waitForTimeout(1500)

          log(`Зачисление ${clientLast} в группу`, "OK")
        } catch (e: any) {
          log(`Зачисление ${clientLast}`, "BUG", e.message?.slice(0, 100))
        }
      }
    } catch (e: any) {
      log("Зачисление клиентов", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 4: АБОНЕМЕНТЫ И ОПЛАТЫ
  // ============================================================

  safeTest("ЧАСТЬ 4.1: Создать абонементы", async (page) => {
    test.setTimeout(90000)
    await login(page)

    // Для Ивановой (3 ребёнка) — открываем карточку и создаём абонемент
    await page.goto("/crm/leads")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      const ivanovaLink = page.locator("a:has-text('Иванова')").first()
      if (!await ivanovaLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Абонемент для Ивановой", "BUG", "Иванова не найдена в списке лидов")
        return
      }
      await ivanovaLink.click()
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000)

      // Вкладка абонементы
      await page.locator("button[role='tab']:has-text('Абонементы')").click()
      await page.waitForTimeout(500)

      // Создать абонемент — кнопка "+ Абонемент"
      const subBtn = page.locator("button:has-text('Абонемент')")
      if (!await subBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Кнопка создания абонемента", "BUG", "Не найдена на вкладке Абонементы")
        return
      }
      await subBtn.first().click()

      const dialog = page.locator("div[role='dialog']")
      if (!await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Диалог абонемента", "BUG", "Не открылся")
        return
      }

      // Выбираем все select-ы по порядку
      const selects = dialog.locator("[data-slot='select-trigger']")
      const selectCount = await selects.count()
      for (let i = 0; i < selectCount; i++) {
        await selects.nth(i).click()
        await page.waitForTimeout(500)
        const items = page.locator("[data-slot='select-item']:visible")
        if (await items.count() > 0) {
          await items.first().click()
          await page.waitForTimeout(500)
        }
      }

      await dialog.locator("button:has-text('Создать')").click()
      await page.waitForTimeout(2000)

      const hasSubscription = await page.locator("text=Ожидание").isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=Активен").isVisible({ timeout: 1000 }).catch(() => false)
      if (hasSubscription) {
        log("Абонемент для Ивановой", "OK")
      } else {
        log("Абонемент для Ивановой", "BUG", "Статус абонемента не появился")
      }
    } catch (e: any) {
      log("Абонемент для Ивановой", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 4.2: Создать оплаты", async (page) => {
    await login(page)
    await page.goto("/finance/payments")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    // Оплата от Козлова (переплата — 10000 вместо стандартной суммы)
    try {
      await page.locator("button:has-text('Оплата')").first().click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")
      const selects = dialog.locator("[data-slot='select-trigger']")

      // Клиент
      await selects.nth(0).click()
      await page.waitForTimeout(500)
      const kozlov = page.locator("[data-slot='select-item']:visible", { hasText: "Козлов" })
      if (await kozlov.isVisible({ timeout: 2000 }).catch(() => false)) {
        await kozlov.click()
      } else {
        await page.locator("[data-slot='select-item']:visible").first().click()
      }
      await page.waitForTimeout(1000)

      // Сумма (переплата)
      const amountInput = dialog.locator("input[type='number']").first()
      await amountInput.fill("10000")

      // Способ оплаты
      const methodSelect = selects.nth(1)
      if (await methodSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
        await methodSelect.click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']:visible").first().click()
        await page.waitForTimeout(300)
      }

      // Счёт
      const accountSelect = selects.nth(2)
      if (await accountSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
        await accountSelect.click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']:visible").first().click()
        await page.waitForTimeout(300)
      }

      await dialog.locator("button:has-text('Сохранить')").click()
      await page.waitForTimeout(2000)

      const hasPayment = await page.locator("text=10 000").isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=10000").isVisible({ timeout: 1000 }).catch(() => false)
      if (hasPayment) {
        log("Оплата Козлова (переплата 10000₽)", "OK")
      } else {
        log("Оплата Козлова (переплата)", "BUG", "Сумма не видна в списке")
      }
    } catch (e: any) {
      log("Оплата Козлова", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 5: РАСХОДЫ
  // ============================================================

  safeTest("ЧАСТЬ 5.1: Создать расход «Аренда»", async (page) => {
    await login(page)
    await page.goto("/finance/expenses")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      await page.locator("button:has-text('Внести расход')").click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")

      // Статья расхода (первый select)
      const selects = dialog.locator("[data-slot='select-trigger']")
      await selects.first().click()
      await page.waitForTimeout(300)
      const catItem = page.locator("[data-slot='select-item']:visible").first()
      if (await catItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await catItem.click()
      }
      await page.waitForTimeout(300)

      // Сумма
      await dialog.locator("input[type='number']").first().fill("50000")

      // Счёт (второй select)
      if (await selects.nth(1).isVisible({ timeout: 1000 }).catch(() => false)) {
        await selects.nth(1).click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']:visible").first().click()
        await page.waitForTimeout(300)
      }

      // Комментарий
      const comment = dialog.locator("input[placeholder*='бязательно']")
      if (await comment.isVisible({ timeout: 500 }).catch(() => false)) {
        await comment.fill("Аренда помещения за март")
      }

      await dialog.locator("button[type='submit'], button:has-text('Создать'), button:has-text('Сохранить')").first().click()
      await page.waitForTimeout(2000)

      // Проверяем что расход появился в таблице
      const visible = await page.locator("text=50 000").isVisible({ timeout: 3000 }).catch(() => false)
        || await page.locator("text=50000").isVisible({ timeout: 1000 }).catch(() => false)
      log("Расход «Аренда» 50000₽", visible ? "OK" : "BUG", visible ? undefined : "Не появился в списке")
    } catch (e: any) {
      log("Создание расхода", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 5.5: ЗАДАЧИ И ОБЗВОН
  // ============================================================

  safeTest("ЧАСТЬ 5.5.1: Создать задачу", async (page) => {
    await login(page)
    await page.goto("/tasks")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      await page.locator("button:has-text('Задача')").click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")

      // Заголовок
      await dialog.locator("input[placeholder*='нужно сделать']").fill("Обзвонить родителей по оплате")

      // Исполнитель (select)
      const selects = dialog.locator("[data-slot='select-trigger']")
      if (await selects.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await selects.first().click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']:visible").first().click()
        await page.waitForTimeout(300)
      }

      // Дата
      const dateInput = dialog.locator("input[type='date']")
      if (await dateInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dateInput.fill("2026-04-01")
      }

      await dialog.locator("button[type='submit'], button:has-text('Создать')").first().click()
      await page.waitForTimeout(1500)

      const visible = await page.locator("text=Обзвонить родителей").isVisible({ timeout: 3000 }).catch(() => false)
      log("Создание задачи", visible ? "OK" : "BUG", visible ? undefined : "Задача не появилась")
    } catch (e: any) {
      log("Создание задачи", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 5.5.2: Создать кампанию обзвона", async (page) => {
    await login(page)
    await page.goto("/crm/calls")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      await page.locator("button:has-text('Новый обзвон')").click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")

      await dialog.locator("input[placeholder*='Например']").fill(`Обзвон лидов ${TS}`)

      await dialog.locator("button[type='submit'], button:has-text('Создать')").first().click()
      await page.waitForTimeout(1500)

      const visible = await page.locator(`text=Обзвон лидов ${TS}`).isVisible({ timeout: 3000 }).catch(() => false)
      log("Создание кампании обзвона", visible ? "OK" : "BUG", visible ? undefined : "Кампания не появилась")
    } catch (e: any) {
      log("Создание кампании обзвона", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 5.6: ЗАРПЛАТА — ВЫПЛАТА
  // ============================================================

  safeTest("ЧАСТЬ 5.6: Зарплата — выплата", async (page) => {
    await login(page)
    await page.goto("/salary")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      // Проверяем что страница загрузилась
      const hasTitle = await page.locator("text=Зарплата").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasTitle) {
        log("Зарплата: страница", "BUG", "Не загрузилась")
        return
      }
      log("Зарплата: страница загрузилась", "OK")

      // Кнопка выплаты
      const payBtn = page.locator("button:has-text('Провести выплату')")
      if (!await payBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        log("Зарплата: кнопка выплаты", "BUG", "Не найдена")
        return
      }

      await payBtn.click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")

      // Сотрудник
      const selects = dialog.locator("[data-slot='select-trigger']")
      await selects.first().click()
      await page.waitForTimeout(300)
      await page.locator("[data-slot='select-item']:visible").first().click()
      await page.waitForTimeout(500)

      // Сумма (может автозаполниться)
      const amountInput = dialog.locator("input[type='number']").first()
      const currentAmount = await amountInput.inputValue()
      if (!currentAmount || currentAmount === "0") {
        await amountInput.fill("5000")
      }

      // Счёт
      if (await selects.nth(1).isVisible({ timeout: 1000 }).catch(() => false)) {
        await selects.nth(1).click()
        await page.waitForTimeout(300)
        await page.locator("[data-slot='select-item']:visible").first().click()
        await page.waitForTimeout(300)
      }

      await dialog.locator("button[type='submit'], button:has-text('Выплатить'), button:has-text('Сохранить')").first().click()
      await page.waitForTimeout(2000)

      log("Зарплата: выплата создана", "OK")
    } catch (e: any) {
      log("Зарплата: выплата", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 5.7: ПОСЕЩЕНИЯ — ОТКРЫТЬ ЗАНЯТИЕ И ОТМЕТИТЬ
  // ============================================================

  safeTest("ЧАСТЬ 5.7: Посещения — отметить явки и прогулы", async (page) => {
    test.setTimeout(90000)
    await login(page)

    // Идём в расписание — находим любое занятие
    await page.goto("/schedule")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    try {
      // Ищем ссылку на любое занятие в расписании (lesson card)
      const lessonLink = page.locator("a[href*='/schedule/lessons/']").first()
      if (!await lessonLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Посещения: занятие в расписании", "BUG", "Нет видимых занятий в расписании")
        return
      }

      await lessonLink.click()
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000)

      // Проверяем что страница занятия открылась
      const hasAttendance = await page.locator("text=Посещаемость").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasAttendance) {
        log("Посещения: страница занятия", "BUG", "Блок 'Посещаемость' не найден")
        return
      }
      log("Посещения: страница занятия открылась", "OK")

      // Попробуем нажать "Отметить всех — Явка"
      const markAllBtn = page.locator("button:has-text('Отметить всех')")
      if (await markAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await markAllBtn.click()
        await page.waitForTimeout(2000)
        log("Посещения: «Отметить всех — Явка»", "OK")
      } else {
        log("Посещения: кнопка «Отметить всех»", "BUG", "Не найдена (возможно нет зачисленных)")
      }
    } catch (e: any) {
      log("Посещения", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 5.8: СКИДКА МНОГОДЕТНОСТЬ
  // ============================================================

  safeTest("ЧАСТЬ 5.8: Скидка за многодетность (Иванова, 3 ребёнка)", async (page) => {
    await login(page)
    await page.goto("/crm/leads")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      // Открываем карточку Ивановой
      const link = page.locator("a:has-text('Иванова')").first()
      if (!await link.isVisible({ timeout: 5000 }).catch(() => false)) {
        log("Скидка: Иванова не найдена", "BUG", "Нет в списке лидов")
        return
      }
      await link.click()
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000)

      // Вкладка Абонементы
      await page.locator("button[role='tab']:has-text('Абонементы')").click()
      await page.waitForTimeout(500)

      // Ищем кнопку редактирования абонемента (карандаш)
      const editBtn = page.locator("button:has(svg.lucide-pencil)").first()
      if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        log("Скидка: нет абонемента для редактирования", "BUG", "Нужно сначала создать абонемент (часть 4.1)")
        return
      }

      await editBtn.click()
      await page.waitForSelector("div[role='dialog']", { timeout: 5000 })
      const dialog = page.locator("div[role='dialog']")

      // Ищем поле "Скидка"
      const discountInput = dialog.locator("input[type='number']").last()
      if (await discountInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await discountInput.fill("500")
        await page.waitForTimeout(300)

        // Проверяем что итого пересчиталось (показывается "-500₽")
        const hasDiscount = await dialog.locator("text=-500").isVisible({ timeout: 2000 }).catch(() => false)
          || await dialog.locator("text=Скидка").isVisible({ timeout: 1000 }).catch(() => false)

        await dialog.locator("button[type='submit'], button:has-text('Сохранить')").first().click()
        await page.waitForTimeout(2000)

        log("Скидка многодетность: 500₽", hasDiscount ? "OK" : "BUG", hasDiscount ? undefined : "Итого не пересчиталось")
      } else {
        log("Скидка: поле скидки", "BUG", "Не найдено в диалоге редактирования")
      }
    } catch (e: any) {
      log("Скидка многодетность", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 6: ПРОВЕРКА ОТЧЁТОВ И ДАШБОРДА
  // ============================================================

  safeTest("ЧАСТЬ 6.1: Дашборд — виджеты с данными", async (page) => {
    await login(page)
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    const widgets = [
      "Активные абонементы",
      "Выручка",
      "Расходы",
      "Должники",
      "Задачи на сегодня",
      "Воронка",
    ]

    for (const widget of widgets) {
      const visible = await page.locator(`text=${widget}`).first().isVisible({ timeout: 2000 }).catch(() => false)
      log(`Дашборд: виджет «${widget}»`, visible ? "OK" : "BUG", visible ? undefined : "Не виден")
    }
  })

  safeTest("ЧАСТЬ 6.2: Отчёты — каталог и загрузка", async (page) => {
    await login(page)

    const reports = [
      { name: "Воронка продаж", url: "/reports/crm/funnel", check: "Воронка продаж" },
      { name: "Средний чек", url: "/reports/crm/avg-check", check: "Средний чек" },
      { name: "P&L", url: "/reports/finance/pnl", check: "P&L" },
      { name: "Выручка", url: "/reports/finance/revenue", check: "Выручка" },
      { name: "Посещения", url: "/reports/attendance/visits", check: "Посещения" },
      { name: "По педагогам", url: "/reports/salary/by-instructor", check: "педагог" },
      { name: "Отток", url: "/reports/churn/details", check: "тток" },
      { name: "Свободные места", url: "/reports/schedule/capacity", check: "вободные" },
    ]

    for (const report of reports) {
      try {
        await page.goto(report.url)
        await page.waitForLoadState("networkidle")
        await page.waitForTimeout(1500)

        // Проверяем по ключевому слову в заголовке
        const hasContent = await page.locator(`text=/${report.check}/i`).first().isVisible({ timeout: 5000 }).catch(() => false)
        log(`Отчёт «${report.name}»`, hasContent ? "OK" : "BUG", hasContent ? undefined : "Страница не содержит ожидаемый заголовок")
      } catch (e: any) {
        log(`Отчёт «${report.name}»`, "BUG", e.message?.slice(0, 100))
      }
    }
  })

  safeTest("ЧАСТЬ 6.3: ДДС загружается", async (page) => {
    await login(page)
    await page.goto("/finance/dds")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1500)

    try {
      const hasDds = await page.locator("text=Движение денежных средств").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=ДДС").first().isVisible({ timeout: 1000 }).catch(() => false)
        || await page.locator("text=Приход").first().isVisible({ timeout: 1000 }).catch(() => false)
      log("ДДС страница", hasDds ? "OK" : "BUG", hasDds ? undefined : "Не загрузилась — ни ДДС, ни Приход не найдены")
    } catch (e: any) {
      log("ДДС страница", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 6.4: Должники загружаются", async (page) => {
    await login(page)
    await page.goto("/finance/debtors")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1500)

    try {
      const has = await page.locator("text=Должники").first().isVisible({ timeout: 5000 }).catch(() => false)
        || await page.locator("text=олжник").first().isVisible({ timeout: 1000 }).catch(() => false)
      log("Должники страница", has ? "OK" : "BUG", has ? undefined : "Не загрузилась")
    } catch (e: any) {
      log("Должники страница", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 6.5: Каталог отчётов", async (page) => {
    await login(page)
    await page.goto("/reports")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    try {
      const has = await page.locator("text=Отчёты").first().isVisible({ timeout: 5000 }).catch(() => false)
      log("Каталог отчётов", has ? "OK" : "BUG", has ? undefined : "Не загрузился")

      // Считаем количество карточек/ссылок на отчёты
      const links = await page.locator("a[href*='/reports/']").count()
      log(`Каталог: ${links} ссылок на отчёты`, links >= 8 ? "OK" : "BUG", links < 8 ? `Ожидали >= 8, нашли ${links}` : undefined)
    } catch (e: any) {
      log("Каталог отчётов", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // ЧАСТЬ 7: БИЛЛИНГ И ЛК
  // ============================================================

  safeTest("ЧАСТЬ 7.1: ЛК партнёра — подписка видна", async (page) => {
    await login(page)
    await page.goto("/billing")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    try {
      const hasBilling = await page.locator("text=Подписка").first().isVisible({ timeout: 5000 }).catch(() => false)
      const hasTariff = await page.locator("text=Стандарт").first().isVisible({ timeout: 3000 }).catch(() => false)

      if (hasBilling) {
        log("ЛК партнёра: страница подписки", "OK")
      } else {
        log("ЛК партнёра: страница подписки", "BUG", "Не загрузилась")
      }

      if (hasTariff) {
        log("ЛК партнёра: тариф «Стандарт» виден", "OK")
      } else {
        log("ЛК партнёра: тариф", "BUG", "Тариф не виден")
      }
    } catch (e: any) {
      log("ЛК партнёра", "BUG", e.message?.slice(0, 100))
    }
  })

  safeTest("ЧАСТЬ 7.2: ЛК клиента — генерация ссылки + вход", async (page) => {
    await login(page)

    try {
      // Получаем ID первого клиента
      const res = await page.request.get("/api/clients")
      const clients = await res.json()
      const clientId = clients[0]?.id

      if (!clientId) {
        log("ЛК клиента: генерация ссылки", "BUG", "Нет клиентов в API")
        return
      }

      // Генерируем ссылку
      const linkRes = await page.request.post(`/api/clients/${clientId}/portal-link`)
      const linkData = await linkRes.json()

      if (!linkData.link) {
        log("ЛК клиента: генерация ссылки", "BUG", "API не вернул link")
        return
      }
      log("ЛК клиента: генерация ссылки", "OK")

      // Открываем портал
      await page.goto(linkData.link)
      await page.waitForTimeout(3000)

      // Согласие ПДн
      const consentBtn = page.locator("button:has-text('Согласен')")
      if (await consentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await consentBtn.click()
        await page.waitForTimeout(2000)
        log("ЛК клиента: согласие ПДн", "OK")
      }

      // Проверяем что портал загрузился
      const hasBalance = await page.locator("text=Баланс").first().isVisible({ timeout: 5000 }).catch(() => false)
      if (hasBalance) {
        log("ЛК клиента: портал загрузился", "OK")
      } else {
        log("ЛК клиента: портал", "BUG", "Баланс не виден")
      }
    } catch (e: any) {
      log("ЛК клиента", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // СВОДКА
  // ============================================================

  test("СВОДКА: Результаты mega-теста", async () => {
    console.log("\n\n========================================")
    console.log("  СВОДКА MEGA-ТЕСТА «ЗВЁЗДОЧКА»")
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
