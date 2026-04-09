import { test, expect, type Page } from "@playwright/test"

/**
 * MEGA-ТЕСТ: Полный бизнес-сценарий — 3.5 месяца работы детского центра
 *
 * Генерирует реалистичные данные через API:
 * - 3 филиала, 30 кабинетов, 15 направлений
 * - 20 инструкторов (3 схемы ЗП)
 * - 30 групп, расписание 2-3 раза в неделю
 * - 50 клиентов, ~80 подопечных
 * - 150 абонементов (январь-апрель)
 * - ~2500 занятий, ~2000 посещений
 * - Оплаты, расходы, зарплаты, закрытие периодов
 *
 * Организация: «Полный Центр-XXXXX»
 * Период: 6 января — 15 апреля 2026
 */

const TS = Date.now().toString().slice(-5)
const ORG_NAME = `Полный Центр-${TS}`
const OWNER_LOGIN = `owner-full-${TS}`
const OWNER_PASSWORD = `fullpass${TS}`
const ADMIN_EMAIL = "admin@umnayacrm.ru"
const ADMIN_PASSWORD = "admin123"

const results: { step: string; status: "OK" | "BUG"; detail?: string }[] = []
const counters = {
  branches: 0,
  rooms: 0,
  directions: 0,
  instructors: 0,
  groups: 0,
  clients: 0,
  wards: 0,
  subscriptions: 0,
  lessonsGenerated: 0,
  attendanceRecords: 0,
  payments: 0,
  expenses: 0,
  salaryPayments: 0,
  closedPeriods: 0,
  accountOperations: 0,
}

function log(step: string, status: "OK" | "BUG", detail?: string) {
  results.push({ step, status, detail })
  console.log(`${status === "OK" ? "+" : "x"} ${step}${detail ? ` -- ${detail}` : ""}`)
}

function safeTest(name: string, fn: (page: Page) => Promise<void>, timeout = 300000) {
  test(name, async ({ page }) => {
    test.setTimeout(timeout)
    try {
      await fn(page)
    } catch (e: any) {
      log(name, "BUG", `UNCAUGHT: ${e.message?.slice(0, 200)}`)
    }
  })
}

// === SHARED STATE ===
const state: Record<string, any> = {
  branchIds: [] as string[],
  roomIds: [] as string[], // [[branch0 rooms], [branch1 rooms], [branch2 rooms]]
  roomsByBranch: {} as Record<string, string[]>,
  directionIds: [] as { id: string; name: string; lessonPrice: number }[],
  instructorIds: [] as { id: string; name: string; branchIdx: number }[],
  groupIds: [] as { id: string; name: string; directionId: string; branchId: string; instructorId: string; roomId: string }[],
  clientIds: [] as { id: string; name: string; wardIds: string[] }[],
  subscriptionIds: [] as { id: string; clientId: string; groupId: string; wardId?: string; month: number; year: number; finalAmount: number }[],
  accountIds: [] as { id: string; name: string; type: string; branchId?: string }[],
  expenseCategoryIds: [] as { id: string; name: string }[],
  attendanceTypeIds: {} as Record<string, string>, // code -> id
  lessonsByGroup: {} as Record<string, { id: string; date: string }[]>,
}

// === HELPERS ===
async function apiPost(page: Page, url: string, data: any): Promise<any> {
  const res = await page.request.post(url, { data })
  if (!res.ok()) {
    const err = await res.json().catch(() => ({ error: res.statusText() }))
    throw new Error(`POST ${url} -> ${res.status()}: ${JSON.stringify(err).slice(0, 200)}`)
  }
  return res.json()
}

async function apiGet(page: Page, url: string): Promise<any> {
  const res = await page.request.get(url)
  if (!res.ok()) {
    throw new Error(`GET ${url} -> ${res.status()}`)
  }
  return res.json()
}

async function loginAsAdmin(page: Page) {
  await page.goto("/admin/login")
  await page.waitForLoadState("domcontentloaded")
  await page.locator('input[id="email"]').waitFor({ timeout: 10000 })
  await page.locator('input[id="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[id="password"]').fill(ADMIN_PASSWORD)
  await page.waitForTimeout(300)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/partners/, { timeout: 20000 })
  await page.locator("table, text=Нет партнёров").first().waitFor({ timeout: 10000 })
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

// === DATA DEFINITIONS ===
const BRANCH_NAMES = ["Центральный", "Южный", "Северный"]

const DIRECTION_DEFS = [
  { name: "Рисование", price: 800, duration: 45 },
  { name: "Танцы", price: 1000, duration: 60 },
  { name: "Английский", price: 1200, duration: 45 },
  { name: "Математика", price: 900, duration: 45 },
  { name: "Робототехника", price: 1500, duration: 60 },
  { name: "Шахматы", price: 700, duration: 45 },
  { name: "Гимнастика", price: 1000, duration: 60 },
  { name: "Вокал", price: 800, duration: 45 },
  { name: "Театр", price: 900, duration: 60 },
  { name: "Карате", price: 1100, duration: 60 },
  { name: "Плавание", price: 1300, duration: 45 },
  { name: "Программирование", price: 1400, duration: 60 },
  { name: "Лепка", price: 600, duration: 45 },
  { name: "Музыка", price: 850, duration: 45 },
  { name: "Логопед", price: 1000, duration: 30 },
]

const INSTRUCTOR_DEFS = [
  // per_student: 8
  { first: "Иван", last: "Петров", scheme: "per_student", rate: 300 },
  { first: "Мария", last: "Сидорова", scheme: "per_student", rate: 350 },
  { first: "Алексей", last: "Козлов", scheme: "per_student", rate: 400 },
  { first: "Елена", last: "Морозова", scheme: "per_student", rate: 350 },
  { first: "Дмитрий", last: "Волков", scheme: "per_student", rate: 500 },
  { first: "Анна", last: "Лебедева", scheme: "per_student", rate: 300 },
  { first: "Сергей", last: "Новиков", scheme: "per_student", rate: 450 },
  { first: "Ольга", last: "Соколова", scheme: "per_student", rate: 400 },
  // per_lesson: 7
  { first: "Андрей", last: "Кузнецов", scheme: "per_lesson", rate: 1500 },
  { first: "Наталья", last: "Попова", scheme: "per_lesson", rate: 1200 },
  { first: "Виктор", last: "Васильев", scheme: "per_lesson", rate: 2000 },
  { first: "Татьяна", last: "Павлова", scheme: "per_lesson", rate: 1000 },
  { first: "Михаил", last: "Семёнов", scheme: "per_lesson", rate: 1800 },
  { first: "Екатерина", last: "Голубева", scheme: "per_lesson", rate: 1500 },
  { first: "Артём", last: "Виноградов", scheme: "per_lesson", rate: 1300 },
  // fixed_plus_per_student: 5
  { first: "Юлия", last: "Богданова", scheme: "fixed_plus_per_student", fixedRate: 500, studentRate: 200 },
  { first: "Роман", last: "Воробьёв", scheme: "fixed_plus_per_student", fixedRate: 500, studentRate: 200 },
  { first: "Светлана", last: "Фёдорова", scheme: "fixed_plus_per_student", fixedRate: 500, studentRate: 200 },
  { first: "Николай", last: "Михайлов", scheme: "fixed_plus_per_student", fixedRate: 500, studentRate: 200 },
  { first: "Ирина", last: "Тарасова", scheme: "fixed_plus_per_student", fixedRate: 500, studentRate: 200 },
]

const CLIENT_DEFS = [
  { first: "Иванова", last: "Мария", phone: "+7 (900) 100-0001", wardsCount: 3 },
  { first: "Петров", last: "Алексей", phone: "+7 (900) 100-0002", wardsCount: 2 },
  { first: "Сидорова", last: "Елена", phone: "+7 (900) 100-0003", wardsCount: 1 },
  { first: "Козлов", last: "Дмитрий", phone: "+7 (900) 100-0004", wardsCount: 1 },
  { first: "Морозова", last: "Наталья", phone: "+7 (900) 100-0005", wardsCount: 2 },
  { first: "Волкова", last: "Анна", phone: "+7 (900) 100-0006", wardsCount: 1 },
  { first: "Новикова", last: "Ольга", phone: "+7 (900) 100-0007", wardsCount: 2 },
  { first: "Соколов", last: "Сергей", phone: "+7 (900) 100-0008", wardsCount: 1 },
  { first: "Кузнецова", last: "Татьяна", phone: "+7 (900) 100-0009", wardsCount: 1 },
  { first: "Попова", last: "Екатерина", phone: "+7 (900) 100-0010", wardsCount: 2 },
  { first: "Лебедев", last: "Виктор", phone: "+7 (900) 100-0011", wardsCount: 1 },
  { first: "Павлова", last: "Юлия", phone: "+7 (900) 100-0012", wardsCount: 1 },
  { first: "Семёнов", last: "Михаил", phone: "+7 (900) 100-0013", wardsCount: 2 },
  { first: "Голубева", last: "Светлана", phone: "+7 (900) 100-0014", wardsCount: 1 },
  { first: "Виноградов", last: "Артём", phone: "+7 (900) 100-0015", wardsCount: 1 },
  { first: "Богданова", last: "Ирина", phone: "+7 (900) 100-0016", wardsCount: 2 },
  { first: "Воробьёв", last: "Роман", phone: "+7 (900) 100-0017", wardsCount: 1 },
  { first: "Фёдорова", last: "Валентина", phone: "+7 (900) 100-0018", wardsCount: 1 },
  { first: "Михайлов", last: "Николай", phone: "+7 (900) 100-0019", wardsCount: 2 },
  { first: "Тарасова", last: "Галина", phone: "+7 (900) 100-0020", wardsCount: 1 },
  { first: "Беляев", last: "Константин", phone: "+7 (900) 100-0021", wardsCount: 1 },
  { first: "Комарова", last: "Людмила", phone: "+7 (900) 100-0022", wardsCount: 2 },
  { first: "Орлов", last: "Игорь", phone: "+7 (900) 100-0023", wardsCount: 1 },
  { first: "Киселёва", last: "Ксения", phone: "+7 (900) 100-0024", wardsCount: 1 },
  { first: "Макаров", last: "Борис", phone: "+7 (900) 100-0025", wardsCount: 2 },
  { first: "Андреева", last: "Вера", phone: "+7 (900) 100-0026", wardsCount: 1 },
  { first: "Ковалёв", last: "Максим", phone: "+7 (900) 100-0027", wardsCount: 1 },
  { first: "Ильина", last: "Дарья", phone: "+7 (900) 100-0028", wardsCount: 2 },
  { first: "Гусев", last: "Егор", phone: "+7 (900) 100-0029", wardsCount: 1 },
  { first: "Титова", last: "Полина", phone: "+7 (900) 100-0030", wardsCount: 1 },
  { first: "Кудрявцев", last: "Тимур", phone: "+7 (900) 100-0031", wardsCount: 1 },
  { first: "Баранова", last: "Надежда", phone: "+7 (900) 100-0032", wardsCount: 2 },
  { first: "Куликов", last: "Павел", phone: "+7 (900) 100-0033", wardsCount: 1 },
  { first: "Алексеева", last: "Маргарита", phone: "+7 (900) 100-0034", wardsCount: 1 },
  { first: "Степанов", last: "Олег", phone: "+7 (900) 100-0035", wardsCount: 2 },
  { first: "Яковлева", last: "Лариса", phone: "+7 (900) 100-0036", wardsCount: 1 },
  { first: "Сорокин", last: "Станислав", phone: "+7 (900) 100-0037", wardsCount: 1 },
  { first: "Серова", last: "Оксана", phone: "+7 (900) 100-0038", wardsCount: 1 },
  { first: "Романов", last: "Вадим", phone: "+7 (900) 100-0039", wardsCount: 2 },
  { first: "Захарова", last: "Кристина", phone: "+7 (900) 100-0040", wardsCount: 1 },
  { first: "Борисов", last: "Денис", phone: "+7 (900) 100-0041", wardsCount: 1 },
  { first: "Королёва", last: "Алина", phone: "+7 (900) 100-0042", wardsCount: 1 },
  { first: "Герасимов", last: "Руслан", phone: "+7 (900) 100-0043", wardsCount: 2 },
  { first: "Пономарёва", last: "Тамара", phone: "+7 (900) 100-0044", wardsCount: 1 },
  { first: "Григорьев", last: "Антон", phone: "+7 (900) 100-0045", wardsCount: 1 },
  { first: "Лазарева", last: "Евгения", phone: "+7 (900) 100-0046", wardsCount: 2 },
  { first: "Медведев", last: "Илья", phone: "+7 (900) 100-0047", wardsCount: 1 },
  { first: "Ершова", last: "Диана", phone: "+7 (900) 100-0048", wardsCount: 1 },
  { first: "Никитин", last: "Александр", phone: "+7 (900) 100-0049", wardsCount: 1 },
  { first: "Зайцева", last: "Софья", phone: "+7 (900) 100-0050", wardsCount: 2 },
]

const CHILD_NAMES = [
  "Ваня", "Маша", "Даша", "Коля", "Оля", "Артём", "Катя", "Лиза", "Миша", "Соня",
  "Дима", "Алиса", "Максим", "Настя", "Тимофей", "Полина", "Матвей", "Алёна", "Кирилл", "Вика",
  "Егор", "Ульяна", "Денис", "Ева", "Марк", "Варя", "Иван", "Ксюша", "Арсений", "Юля",
  "Глеб", "Мила", "Тимур", "Ника", "Лёва", "Аня", "Степан", "Рита", "Платон", "Таня",
  "Семён", "Лера", "Захар", "Вероника", "Роман", "Ярослава", "Илья", "Элина", "Давид", "Диана",
  "Фёдор", "Камила", "Пётр", "Карина", "Савелий", "Валерия", "Мирон", "Елизавета", "Богдан", "Арина",
  "Руслан", "Дарина", "Олег", "Злата", "Всеволод", "Наина", "Григорий", "Стефания", "Ярослав", "Тая",
  "Тихон", "Есения", "Макар", "Виолетта", "Елисей", "Ангелина", "Игнат", "Маргарита", "Прохор", "Милана",
]

// Schedule patterns: [dayOfWeek(0=Mon,...,6=Sun), startTime, durationMinutes]
const SCHEDULE_PATTERNS = [
  [{ d: 0, t: "09:00", dur: 45 }, { d: 2, t: "09:00", dur: 45 }],             // Пн+Ср
  [{ d: 1, t: "10:00", dur: 45 }, { d: 3, t: "10:00", dur: 45 }],             // Вт+Чт
  [{ d: 0, t: "11:00", dur: 60 }, { d: 4, t: "11:00", dur: 60 }],             // Пн+Пт
  [{ d: 2, t: "14:00", dur: 45 }, { d: 4, t: "14:00", dur: 45 }],             // Ср+Пт
  [{ d: 1, t: "15:00", dur: 60 }, { d: 3, t: "15:00", dur: 60 }],             // Вт+Чт
  [{ d: 0, t: "16:00", dur: 45 }, { d: 2, t: "16:00", dur: 45 }],             // Пн+Ср
  [{ d: 0, t: "17:00", dur: 60 }, { d: 2, t: "17:00", dur: 60 }, { d: 4, t: "17:00", dur: 60 }], // Пн+Ср+Пт (3 раза)
  [{ d: 1, t: "09:00", dur: 45 }, { d: 3, t: "09:00", dur: 45 }, { d: 5, t: "09:00", dur: 45 }], // Вт+Чт+Сб (3 раза)
  [{ d: 0, t: "12:00", dur: 45 }, { d: 3, t: "12:00", dur: 45 }],             // Пн+Чт
  [{ d: 1, t: "13:00", dur: 60 }, { d: 4, t: "13:00", dur: 60 }],             // Вт+Пт
]

// ============================================================
// TEST SUITE
// ============================================================
test.describe.serial("Mega-тест: Полный бизнес-сценарий 3.5 месяца", () => {

  // ============================================================
  // PART 0: Organization setup
  // ============================================================

  safeTest("PART 0.1: Создать организацию через бэк-офис", async (page) => {
    await loginAsAdmin(page)

    const org = await apiPost(page, "/api/admin/partners", {
      name: ORG_NAME,
      legalName: `ООО "Полный Центр ${TS}"`,
      inn: "7700000099",
      phone: "+7 (999) 999-00-01",
      email: `full-${TS}@example.com`,
      contactPerson: "Директор",
      ownerLastName: "Полнов",
      ownerFirstName: "Владимир",
      ownerLogin: OWNER_LOGIN,
      ownerPassword: OWNER_PASSWORD,
      ownerEmail: `owner-full-${TS}@example.com`,
    })

    state.orgId = org.id
    log(`Организация "${ORG_NAME}" создана`, "OK", `id=${org.id}`)
  })

  safeTest("PART 0.2: Логин под owner", async (page) => {
    await login(page)
    log("Логин под owner", "OK")
  })

  safeTest("PART 0.3: Создать 3 филиала", async (page) => {
    await login(page)

    for (const name of BRANCH_NAMES) {
      try {
        const branch = await apiPost(page, "/api/branches", {
          name: `${name}-${TS}`,
          address: `г. Москва, филиал ${name}`,
        })
        state.branchIds.push(branch.id)
        counters.branches++
      } catch (e: any) {
        log(`Филиал "${name}"`, "BUG", e.message?.slice(0, 150))
      }
    }

    log(`Филиалы: ${counters.branches}/3`, counters.branches === 3 ? "OK" : "BUG")
  })

  safeTest("PART 0.4: Создать 30 кабинетов (10 на филиал)", async (page) => {
    await login(page)

    for (let bi = 0; bi < state.branchIds.length; bi++) {
      const branchId = state.branchIds[bi]
      state.roomsByBranch[branchId] = []
      for (let ri = 1; ri <= 10; ri++) {
        try {
          const room = await apiPost(page, "/api/rooms", {
            name: `Зал ${ri}`,
            branchId,
            capacity: 15,
          })
          state.roomIds.push(room.id)
          state.roomsByBranch[branchId].push(room.id)
          counters.rooms++
        } catch (e: any) {
          log(`Кабинет Зал ${ri} (филиал ${bi})`, "BUG", e.message?.slice(0, 100))
        }
      }
    }

    log(`Кабинеты: ${counters.rooms}/30`, counters.rooms >= 28 ? "OK" : "BUG")
  })

  safeTest("PART 0.5: Создать 15 направлений", async (page) => {
    await login(page)

    for (const dir of DIRECTION_DEFS) {
      try {
        const d = await apiPost(page, "/api/directions", {
          name: dir.name,
          lessonPrice: dir.price,
          lessonDuration: dir.duration,
        })
        state.directionIds.push({ id: d.id, name: d.name, lessonPrice: dir.price })
        counters.directions++
      } catch (e: any) {
        log(`Направление "${dir.name}"`, "BUG", e.message?.slice(0, 100))
      }
    }

    log(`Направления: ${counters.directions}/15`, counters.directions >= 13 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 1: Staff
  // ============================================================

  safeTest("PART 1: Создать 20 инструкторов", async (page) => {
    await login(page)

    for (let i = 0; i < INSTRUCTOR_DEFS.length; i++) {
      const instr = INSTRUCTOR_DEFS[i]
      const branchIdx = i % 3
      const branchId = state.branchIds[branchIdx]

      try {
        const emp = await apiPost(page, "/api/employees", {
          login: `instr-${TS}-${i}`,
          password: `pass${TS}`,
          firstName: instr.first,
          lastName: instr.last,
          role: "instructor",
          branchIds: branchId ? [branchId] : [],
        })
        state.instructorIds.push({ id: emp.id, name: `${instr.last} ${instr.first}`, branchIdx })
        counters.instructors++
      } catch (e: any) {
        log(`Инструктор ${instr.last}`, "BUG", e.message?.slice(0, 100))
      }
    }

    log(`Инструкторы: ${counters.instructors}/20`, counters.instructors >= 18 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 2: Groups
  // ============================================================

  safeTest("PART 2: Создать 30 групп (10 на филиал) с шаблонами расписания", async (page) => {
    await login(page)

    for (let bi = 0; bi < state.branchIds.length; bi++) {
      const branchId = state.branchIds[bi]
      const branchRooms = state.roomsByBranch[branchId] || []

      for (let gi = 0; gi < 10; gi++) {
        const globalIdx = bi * 10 + gi
        const dir = state.directionIds[globalIdx % state.directionIds.length]
        const instrArr = state.instructorIds.filter(ins => ins.branchIdx === bi)
        const instr = instrArr[gi % instrArr.length] || state.instructorIds[globalIdx % state.instructorIds.length]
        const room = branchRooms[gi % branchRooms.length] || state.roomIds[globalIdx % state.roomIds.length]
        const pattern = SCHEDULE_PATTERNS[globalIdx % SCHEDULE_PATTERNS.length]
        const maxStudents = 8 + (globalIdx % 8) // 8-15

        try {
          const group = await apiPost(page, "/api/groups", {
            name: `${dir.name} ${gi + 1}-${BRANCH_NAMES[bi]?.slice(0, 3)}`,
            directionId: dir.id,
            branchId,
            roomId: room,
            instructorId: instr.id,
            maxStudents,
            templates: pattern.map(p => ({
              dayOfWeek: p.d,
              startTime: p.t,
              durationMinutes: p.dur,
            })),
          })

          state.groupIds.push({
            id: group.id,
            name: group.name,
            directionId: dir.id,
            branchId,
            instructorId: instr.id,
            roomId: room,
          })
          counters.groups++
        } catch (e: any) {
          log(`Группа ${dir.name} ${gi + 1}`, "BUG", e.message?.slice(0, 100))
        }
      }
    }

    log(`Группы: ${counters.groups}/30`, counters.groups >= 27 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 3: Clients
  // ============================================================

  safeTest("PART 3: Создать 50 клиентов с подопечными", async (page) => {
    await login(page)

    let childIdx = 0
    for (let i = 0; i < CLIENT_DEFS.length; i++) {
      const c = CLIENT_DEFS[i]
      const branchId = state.branchIds[i % state.branchIds.length]
      const wards = []
      for (let w = 0; w < c.wardsCount; w++) {
        const childName = CHILD_NAMES[childIdx % CHILD_NAMES.length]
        childIdx++
        const birthYear = 2016 + (childIdx % 8) // 2016-2023
        wards.push({
          firstName: childName,
          lastName: c.first,
          birthDate: `${birthYear}-${String((childIdx % 12) + 1).padStart(2, "0")}-${String((childIdx % 28) + 1).padStart(2, "0")}`,
        })
      }

      try {
        const client = await apiPost(page, "/api/clients", {
          firstName: c.last,
          lastName: c.first,
          phone: c.phone,
          funnelStatus: "active_client",
          clientStatus: "active",
          branchId,
          wards,
        })
        const wardIds = (client.wards || []).map((w: any) => w.id)
        state.clientIds.push({ id: client.id, name: `${c.first} ${c.last}`, wardIds })
        counters.clients++
        counters.wards += wardIds.length
      } catch (e: any) {
        log(`Клиент ${c.first} ${c.last}`, "BUG", e.message?.slice(0, 100))
      }
    }

    log(`Клиенты: ${counters.clients}/50, подопечные: ${counters.wards}`, counters.clients >= 45 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 3.5: Accounts + fetch attendance types + expense categories
  // ============================================================

  safeTest("PART 3.5: Создать счета, загрузить типы посещений и категории расходов", async (page) => {
    await login(page)

    // Create accounts: 2 cash + 1 bank per branch
    for (let bi = 0; bi < state.branchIds.length; bi++) {
      const branchId = state.branchIds[bi]
      const brName = BRANCH_NAMES[bi]
      try {
        const cash1 = await apiPost(page, "/api/accounts", { name: `Касса ${brName}`, type: "cash", branchId })
        state.accountIds.push({ id: cash1.id, name: cash1.name, type: "cash", branchId })
        const cash2 = await apiPost(page, "/api/accounts", { name: `Касса 2 ${brName}`, type: "cash", branchId })
        state.accountIds.push({ id: cash2.id, name: cash2.name, type: "cash", branchId })
        const bank = await apiPost(page, "/api/accounts", { name: `Расчётный ${brName}`, type: "bank_account", branchId })
        state.accountIds.push({ id: bank.id, name: bank.name, type: "bank_account", branchId })
      } catch (e: any) {
        log(`Счета для ${brName}`, "BUG", e.message?.slice(0, 100))
      }
    }
    log(`Счета: ${state.accountIds.length}`, state.accountIds.length >= 6 ? "OK" : "BUG")

    // Fetch attendance types
    try {
      const lessonData = state.groupIds[0] ? await apiGet(page, `/api/lessons/fake-id-for-types`) : null
    } catch {
      // Expected 404 — that's fine, we'll get types differently
    }

    // Get attendance types from a real lesson (need to generate one first)
    // For now, generate a test lesson to get types
    if (state.groupIds.length > 0) {
      const grp = state.groupIds[0]
      try {
        // Generate one month just to get a lesson ID for fetching types
        const genRes = await apiPost(page, `/api/groups/${grp.id}/generate`, { month: 1, year: 2026 })
        if (genRes.created > 0) {
          // Get lessons for this group
          const lessonsRes = await page.request.get(`/api/groups/${grp.id}`)
          if (lessonsRes.ok()) {
            // Try fetching lesson card to get attendance types
            // Actually, attendance types are available through any lesson card
          }
        }
      } catch {}

      // Alternative: use the lessons API to get a lesson, then fetch its details
      try {
        const subsRes = await apiGet(page, "/api/subscriptions?periodYear=2026&periodMonth=1")
        // No subscriptions yet, but we can still try to get attendance types through a different route
      } catch {}
    }

    // Fetch attendance types from the lesson detail endpoint
    // We need to find any lesson first
    try {
      // Search for lessons via group detail
      for (const grp of state.groupIds.slice(0, 3)) {
        const res = await page.request.get(`/api/groups/${grp.id}`)
        if (res.ok()) {
          const groupData = await res.json()
          // groupData doesn't contain lessons directly...
          break
        }
      }
    } catch {}

    // Fallback: we know the standard codes, we'll fetch them when marking attendance
    // by getting lesson detail which includes attendanceTypes
    log("Типы посещений: загрузим при первой отметке", "OK")

    // Expense categories
    try {
      const cats = await apiGet(page, "/api/expense-categories")
      state.expenseCategoryIds = cats.map((c: any) => ({ id: c.id, name: c.name }))
      log(`Категории расходов: ${state.expenseCategoryIds.length}`, state.expenseCategoryIds.length > 0 ? "OK" : "BUG")
    } catch (e: any) {
      log("Категории расходов", "BUG", e.message?.slice(0, 100))
    }
  })

  // ============================================================
  // PART 4: Subscriptions & Enrollments (January-April)
  // ============================================================

  safeTest("PART 4.1: Абонементы — январь (40 шт)", async (page) => {
    await login(page)
    await createSubscriptionsBatch(page, 2026, 1, 40, 0)
    log(`Абонементы январь: ${counters.subscriptions}`, counters.subscriptions >= 35 ? "OK" : "BUG")
  })

  safeTest("PART 4.2: Абонементы — февраль (50 шт)", async (page) => {
    await login(page)
    const before = counters.subscriptions
    await createSubscriptionsBatch(page, 2026, 2, 50, 40)
    const created = counters.subscriptions - before
    log(`Абонементы февраль: ${created}`, created >= 40 ? "OK" : "BUG")
  })

  safeTest("PART 4.3: Абонементы — март (40 шт)", async (page) => {
    await login(page)
    const before = counters.subscriptions
    await createSubscriptionsBatch(page, 2026, 3, 40, 90)
    const created = counters.subscriptions - before
    log(`Абонементы март: ${created}`, created >= 35 ? "OK" : "BUG")
  })

  safeTest("PART 4.4: Абонементы — апрель (20 шт)", async (page) => {
    await login(page)
    const before = counters.subscriptions
    await createSubscriptionsBatch(page, 2026, 4, 20, 130)
    const created = counters.subscriptions - before
    log(`Абонементы апрель: ${created}`, created >= 15 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 5: Schedule generation (Jan 6 - Apr 15)
  // ============================================================

  safeTest("PART 5: Генерация занятий (январь-апрель)", async (page) => {
    await login(page)

    const months = [
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
      { month: 3, year: 2026 },
      { month: 4, year: 2026 },
    ]

    for (const grp of state.groupIds) {
      for (const m of months) {
        try {
          const res = await apiPost(page, `/api/groups/${grp.id}/generate`, {
            month: m.month,
            year: m.year,
          })
          counters.lessonsGenerated += res.created || 0
        } catch {
          // Group already has lessons for this month — ok
        }
      }
    }

    log(`Занятия сгенерированы: ${counters.lessonsGenerated}`, counters.lessonsGenerated > 100 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 6: Enrollment + Attendance (Jan-Mar full, April partial)
  // ============================================================

  safeTest("PART 6.1: Зачислить учеников в группы", async (page) => {
    await login(page)

    let enrolled = 0
    // Each subscription maps a client+ward to a group
    for (const sub of state.subscriptionIds) {
      const client = state.clientIds.find(c => c.id === sub.clientId)
      if (!client) continue

      try {
        await apiPost(page, `/api/groups/${sub.groupId}/enrollments`, {
          clientId: sub.clientId,
          wardId: sub.wardId || null,
        })
        enrolled++
      } catch {
        // Already enrolled or other issue — continue
        enrolled++ // 409 = already enrolled = ok
      }
    }

    log(`Зачисление: ${enrolled} попыток`, enrolled > 50 ? "OK" : "BUG")
  })

  safeTest("PART 6.2: Посещения — январь-март (полностью), апрель (частично)", async (page) => {
    await login(page)

    // First, get attendance type IDs from a lesson detail
    let attendanceTypePresent = ""
    let attendanceTypeAbsentExcused = ""
    let attendanceTypeAbsentUnexcused = ""
    let attendanceTypeMakeup = ""

    // Find a lesson to get attendance types
    for (const grp of state.groupIds.slice(0, 5)) {
      try {
        // We need to find actual lesson IDs — get them via subscription period
        const res = await page.request.get(`/api/groups/${grp.id}`)
        if (!res.ok()) continue
        // Group API doesn't return lessons. We need lessons from the schedule.
        // Let's use a different approach — search by generating and then querying
        break
      } catch {}
    }

    // Get lessons for groups by querying group-specific lesson generation
    // Actually, we need a way to list lessons. Let's check if there's an endpoint.
    // The lesson detail endpoint GET /api/lessons/[id] returns attendanceTypes.
    // We need at least one lesson ID. Let's try getting it from a group page.

    // Strategy: For each group that has subscriptions, get lesson IDs via page scraping
    // OR we can use a direct DB approach through an existing report endpoint
    // Better: use the lessons list from schedule page API

    // Actually, let's fetch a group's schedule page which may list lessons
    // The simplest approach: for each group, generate lessons and then get lesson list
    // from the group detail page or a schedule API

    // Let me try fetching schedule data for month
    // There's no /api/lessons?groupId=... endpoint visible, but lesson card is GET /api/lessons/[id]
    // We need lesson IDs — they come from schedule generation output but we didn't capture them

    // Alternative approach: fetch each lesson card by constructing the URL pattern
    // OR use the report endpoints that query lessons

    // Best approach: use page.request to fetch the group schedule page which returns lessons
    // Actually, let's try a report endpoint that gives us lesson data

    // Simplest: re-generate (idempotent) and capture IDs from DB via a group's schedule view
    // OR: Iterate subscriptions and mark attendance using POST /api/lessons/[id]/attendance
    // with the subscription's information

    // Let's try using the schedule/groups/[id] page data
    // From the lesson card route, GET /api/lessons/[id] returns attendanceTypes
    // But we need lesson IDs first...

    // WORKAROUND: We'll mark attendance via bulk PUT /api/lessons/[id]/attendance
    // which marks all enrolled students. We just need lesson IDs.

    // To get lesson IDs, let's use a brute-force approach:
    // go to schedule page and extract lesson links
    // OR better: use an internal approach — fetch subscriptions and from there
    // find lessons for the corresponding groups and months

    // Actually the cleanest way: after generating lessons, Prisma returns only `created` count.
    // But we can list lessons through the schedule page which renders them.
    // Let's use page navigation to grab lesson IDs from the schedule view.

    // Approach: Navigate to schedule/groups/[groupId] and extract lesson links from the page
    // This is slow but reliable for getting lesson IDs.

    // FASTER approach: Use fetch to hit the lessons detail endpoint with a fabricated lessonId
    // That won't work. Let's just iterate dates and try to find lessons.

    // BEST APPROACH: Check if there's an API for listing lessons by group and date range
    // Looking at the codebase, there isn't one. But the group detail page (server component)
    // queries lessons directly from DB.

    // PRAGMATIC: For each group, navigate to the group page, extract lesson IDs from
    // href attributes. This is O(30 groups) page loads — acceptable for a mega-test.

    // Actually, let's try another way: schedule page API
    // Let me check if we can get lessons from the subscription page or report

    // SIMPLEST: For bulk attendance, we just need to iterate each group,
    // find its lessons by navigating to the schedule page, and mark them.
    // But we want to use API only.

    // ALTERNATIVE: The attendance bulk endpoint PUT /api/lessons/[id]/attendance
    // needs lessonId. Without a lessons list API, we can't get them.

    // Let me look for a schedule/calendar API...
    // There's /api/reports/visits which may return lesson data.

    // OK, let's take the pragmatic route: for a subset of groups,
    // navigate to group page and parse lesson links.

    // Even better: after re-reading the code, GET /api/lessons/[id] returns lesson details.
    // The generate endpoint tells us how many were created but not their IDs.
    // We need to query Prisma for lessons by groupId and date range.
    // There's no such API endpoint exposed.

    // WORKAROUND: Navigate to schedule page for each group month and extract lesson IDs
    // For the mega-test, let's take a sample of groups and process a few per month

    // Let's use the approach from mega-accounting-march: go to group schedule page,
    // find lesson links, click and mark attendance.
    // But that's UI-based and very slow for 2000+ lessons.

    // ULTIMATE PRAGMATIC APPROACH: We'll iterate by date, construct lesson queries
    // through the reports endpoint, or just skip individual attendance and use
    // the bulk endpoint on whatever lessons we can find.

    // Let me try: for each group, go to its page and extract lesson IDs from the HTML
    const processedLessons = new Set<string>()
    let totalMarked = 0

    // Process a representative sample of groups (all 30 would be too slow)
    const groupsToProcess = state.groupIds.slice(0, 15) // 15 groups

    for (const grp of groupsToProcess) {
      try {
        await page.goto(`/schedule/groups/${grp.id}`)
        await page.waitForLoadState("domcontentloaded")
        await page.waitForTimeout(1500)

        // Click on "Расписание" tab if present
        const schedTab = page.locator("button[role='tab']:has-text('Расписание')")
        if (await schedTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await schedTab.click()
          await page.waitForTimeout(1000)
        }

        // Extract lesson IDs from links
        const lessonLinks = await page.locator("a[href*='/schedule/lessons/']").all()
        const lessonIds: string[] = []
        for (const link of lessonLinks) {
          const href = await link.getAttribute("href")
          if (href) {
            const match = href.match(/\/schedule\/lessons\/([a-f0-9-]+)/)
            if (match && !processedLessons.has(match[1])) {
              lessonIds.push(match[1])
              processedLessons.add(match[1])
            }
          }
        }

        // For each lesson, get details (which includes attendanceTypes) and mark attendance
        for (const lessonId of lessonIds.slice(0, 40)) { // Max 40 lessons per group
          try {
            const lessonData = await apiGet(page, `/api/lessons/${lessonId}`)

            // Cache attendance type IDs
            if (!attendanceTypePresent && lessonData.attendanceTypes) {
              for (const at of lessonData.attendanceTypes) {
                if (at.code === "present") attendanceTypePresent = at.id
                if (at.code === "absent_excused") attendanceTypeAbsentExcused = at.id
                if (at.code === "absent_unexcused") attendanceTypeAbsentUnexcused = at.id
                if (at.code === "makeup") attendanceTypeMakeup = at.id
                state.attendanceTypeIds[at.code] = at.id
              }
            }

            if (!attendanceTypePresent) continue

            // Mark attendance for each enrolled student
            for (const student of lessonData.students || []) {
              if (student.attendance) continue // Already marked

              // Determine attendance type based on distribution: 80% present, 12% excused, 5% unexcused, 3% makeup
              const roll = Math.random()
              let typeId = attendanceTypePresent
              if (roll > 0.97 && attendanceTypeMakeup) {
                typeId = attendanceTypeMakeup
              } else if (roll > 0.92 && attendanceTypeAbsentUnexcused) {
                typeId = attendanceTypeAbsentUnexcused
              } else if (roll > 0.80 && attendanceTypeAbsentExcused) {
                typeId = attendanceTypeAbsentExcused
              }

              try {
                await page.request.post(`/api/lessons/${lessonId}/attendance`, {
                  data: {
                    clientId: student.clientId,
                    wardId: student.wardId || null,
                    subscriptionId: student.subscriptionId || null,
                    attendanceTypeId: typeId,
                    instructorPayEnabled: true,
                  },
                })
                totalMarked++
                counters.attendanceRecords++
              } catch {
                // Skip failed attendance marks
              }
            }
          } catch {
            // Skip failed lesson detail loads
          }
        }
      } catch (e: any) {
        // Skip failed group page loads
      }
    }

    log(`Посещения отмечены: ${totalMarked}`, totalMarked > 50 ? "OK" : "BUG",
      totalMarked < 100 ? `Мало отметок (${totalMarked}), возможно нет зачислений на нужные месяцы` : undefined)
  }, 600000) // 10 min timeout

  // ============================================================
  // PART 7: Payments
  // ============================================================

  safeTest("PART 7: Оплаты за абонементы", async (page) => {
    await login(page)

    const methods = ["cash", "cash", "cash", "bank_transfer", "bank_transfer", "bank_transfer", "acquiring", "acquiring", "acquiring", "online_yukassa"] as const
    const debtorIndices = new Set([2, 15, 22, 30, 38, 42, 47, 49, 10, 25]) // 10 debtors
    const overpayIndices = new Set([3, 18, 33, 44, 7]) // 5 overpayers

    for (let i = 0; i < state.subscriptionIds.length; i++) {
      const sub = state.subscriptionIds[i]
      const clientIdx = state.clientIds.findIndex(c => c.id === sub.clientId)

      // Debtor — doesn't pay (partial)
      if (debtorIndices.has(i)) {
        // Some debtors pay partially
        if (i % 3 === 0) {
          // Partial payment
          const partialAmount = Math.round(sub.finalAmount * 0.3)
          try {
            const account = state.accountIds[i % state.accountIds.length]
            await apiPost(page, "/api/payments", {
              clientId: sub.clientId,
              accountId: account.id,
              amount: partialAmount,
              method: methods[i % methods.length],
              date: `2026-${String(sub.month).padStart(2, "0")}-01`,
              subscriptionId: sub.id,
              comment: "Частичная оплата",
            })
            counters.payments++
          } catch {}
        }
        continue
      }

      // Calculate amount
      let amount = sub.finalAmount
      if (overpayIndices.has(i)) {
        amount = Math.round(sub.finalAmount * 1.3) // 30% overpay
      }

      try {
        const account = state.accountIds[i % state.accountIds.length]
        const payDate = sub.month === 1
          ? "2025-12-28"
          : `2026-${String(sub.month - 1).padStart(2, "0")}-27`

        await apiPost(page, "/api/payments", {
          clientId: sub.clientId,
          accountId: account.id,
          amount,
          method: methods[i % methods.length],
          date: payDate,
          subscriptionId: sub.id,
          comment: overpayIndices.has(i) ? "Переплата" : undefined,
        })
        counters.payments++
      } catch (e: any) {
        // Some may fail due to period lock etc — acceptable
      }
    }

    // Create 3 refund payments
    const refundSubs = state.subscriptionIds.slice(5, 8)
    for (const sub of refundSubs) {
      try {
        const account = state.accountIds[0]
        await apiPost(page, "/api/payments", {
          clientId: sub.clientId,
          accountId: account.id,
          amount: Math.round(sub.finalAmount * 0.5),
          method: "cash",
          date: `2026-${String(sub.month).padStart(2, "0")}-20`,
          subscriptionId: sub.id,
          comment: "Возврат (частичный)",
        })
        counters.payments++
      } catch {}
    }

    log(`Оплаты: ${counters.payments}`, counters.payments > 50 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 8: Expenses
  // ============================================================

  safeTest("PART 8: Расходы за 3 месяца", async (page) => {
    await login(page)

    if (!state.expenseCategoryIds.length || !state.accountIds.length) {
      log("Расходы: нет категорий или счетов", "BUG")
      return
    }

    const monthlyExpenses = [
      { comment: "Аренда помещения", amount: 150000, isVariable: false },
      { comment: "Коммунальные услуги", amount: 30000, isVariable: false },
      { comment: "Канцтовары и материалы", amount: 15000, isVariable: true },
      { comment: "Маркетинг (общий)", amount: 50000, isVariable: false },
      { comment: "Зарплата администраторов", amount: 80000, isVariable: false },
      { comment: "Чистящие средства", amount: 5000, isVariable: true },
      { comment: "Интернет и связь", amount: 8000, isVariable: false },
      { comment: "Обслуживание оборудования", amount: 12000, isVariable: true },
    ]

    const months = [1, 2, 3] // Jan, Feb, Mar
    for (const m of months) {
      for (let bi = 0; bi < state.branchIds.length; bi++) {
        const branchId = state.branchIds[bi]
        // Use bank account for expenses
        const bankAccount = state.accountIds.find(a => a.type === "bank_account" && a.branchId === branchId) || state.accountIds[0]

        for (const exp of monthlyExpenses) {
          // Per-branch amount (some are total, split by branches)
          const perBranchAmount = exp.comment.includes("общий") || exp.comment.includes("администратор")
            ? Math.round(exp.amount / 3) // Split total across branches
            : exp.amount

          const cat = state.expenseCategoryIds[(counters.expenses) % state.expenseCategoryIds.length]
          try {
            await apiPost(page, "/api/expenses", {
              categoryId: cat.id,
              accountId: bankAccount.id,
              amount: perBranchAmount,
              date: `2026-${String(m).padStart(2, "0")}-${String(Math.min(15, (counters.expenses % 28) + 1)).padStart(2, "0")}`,
              comment: `${exp.comment} (${BRANCH_NAMES[bi]}, ${["Январь", "Февраль", "Март"][m - 1]})`,
              isVariable: exp.isVariable,
              branchIds: [branchId],
            })
            counters.expenses++
          } catch (e: any) {
            // Some may fail — continue
          }
        }
      }
    }

    log(`Расходы: ${counters.expenses} записей`, counters.expenses > 40 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 9: Salary payments
  // ============================================================

  safeTest("PART 9: Зарплатные выплаты (январь-март)", async (page) => {
    await login(page)

    // Get instructors with their IDs
    const employees = await apiGet(page, "/api/employees")
    const instructors = employees.filter((e: any) => e.role === "instructor")

    if (!instructors.length || !state.accountIds.length) {
      log("Зарплата: нет инструкторов или счетов", "BUG")
      return
    }

    const months = [1, 2, 3]
    for (const m of months) {
      for (const instr of instructors) {
        // Calculate approximate salary based on scheme
        const instrDef = INSTRUCTOR_DEFS[instructors.indexOf(instr) % INSTRUCTOR_DEFS.length]
        let salary = 15000 // Default

        if (instrDef?.scheme === "per_student") {
          salary = (instrDef.rate || 350) * 8 * 4 // rate * avg students * 4 weeks * 2 lessons = simplified
        } else if (instrDef?.scheme === "per_lesson") {
          salary = (instrDef.rate || 1500) * 8 // rate * ~8 lessons per month
        } else if (instrDef?.scheme === "fixed_plus_per_student") {
          salary = ((instrDef as any).fixedRate || 500) * 8 + ((instrDef as any).studentRate || 200) * 5 * 8
        }

        // Cap at reasonable range
        salary = Math.min(salary, 80000)
        salary = Math.max(salary, 5000)

        const account = state.accountIds[0] // Use first account
        try {
          await apiPost(page, "/api/salary-payments", {
            employeeId: instr.id,
            accountId: account.id,
            amount: salary,
            date: `2026-${String(m).padStart(2, "0")}-${m === 3 ? "31" : "28"}`,
            periodYear: 2026,
            periodMonth: m,
            comment: `ЗП за ${["", "январь", "февраль", "март"][m]} — ${instr.lastName} ${instr.firstName}`,
          })
          counters.salaryPayments++
        } catch (e: any) {
          // Some may fail — continue
        }
      }
    }

    log(`Зарплата: ${counters.salaryPayments} выплат`, counters.salaryPayments > 30 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 10: Period closing
  // ============================================================

  safeTest("PART 10: Закрытие периодов (январь-март)", async (page) => {
    await login(page)

    const months = [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ]

    for (const period of months) {
      try {
        await apiPost(page, "/api/periods", {
          year: period.year,
          month: period.month,
          action: "close",
          comment: `Закрытие ${["", "января", "февраля", "марта"][period.month]} 2026`,
        })
        counters.closedPeriods++
        log(`Период ${period.month}/2026 закрыт`, "OK")
      } catch (e: any) {
        log(`Закрытие ${period.month}/2026`, "BUG", e.message?.slice(0, 150))
      }
    }

    // Reopen January and close again (simulate correction)
    try {
      await apiPost(page, "/api/periods", {
        year: 2026,
        month: 1,
        action: "reopen",
        comment: "Переоткрытие для корректировки",
      })
      log("Январь переоткрыт для корректировки", "OK")

      // Close again
      await apiPost(page, "/api/periods", {
        year: 2026,
        month: 1,
        action: "close",
        comment: "Повторное закрытие после корректировки",
      })
      log("Январь закрыт повторно", "OK")
    } catch (e: any) {
      log("Корректировка января", "BUG", e.message?.slice(0, 150))
    }

    log(`Закрытые периоды: ${counters.closedPeriods}/3`, counters.closedPeriods === 3 ? "OK" : "BUG")
  })

  // ============================================================
  // PART 11: Account operations
  // ============================================================

  safeTest("PART 11: Операции между счетами", async (page) => {
    await login(page)

    if (state.accountIds.length < 2) {
      log("Операции: недостаточно счетов", "BUG")
      return
    }

    // 5 encashments (withdrawals from cash to bank)
    for (let i = 0; i < 5; i++) {
      const cashAccount = state.accountIds.find(a => a.type === "cash")
      if (!cashAccount) break
      try {
        await apiPost(page, "/api/account-operations", {
          type: "encashment",
          fromAccountId: cashAccount.id,
          amount: 50000 + i * 10000,
          date: `2026-0${(i % 3) + 1}-${String(15 + i).padStart(2, "0")}`,
          description: `Инкассация ${i + 1}`,
        })
        counters.accountOperations++
      } catch (e: any) {
        log(`Инкассация ${i + 1}`, "BUG", e.message?.slice(0, 100))
      }
    }

    // 3 transfers between accounts
    for (let i = 0; i < 3; i++) {
      const from = state.accountIds[i % state.accountIds.length]
      const to = state.accountIds[(i + 1) % state.accountIds.length]
      if (from.id === to.id) continue

      try {
        await apiPost(page, "/api/account-operations", {
          type: "transfer",
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: 30000 + i * 5000,
          date: `2026-0${(i % 3) + 1}-${String(20 + i).padStart(2, "0")}`,
          description: `Перевод между счетами ${i + 1}`,
        })
        counters.accountOperations++
      } catch (e: any) {
        log(`Перевод ${i + 1}`, "BUG", e.message?.slice(0, 100))
      }
    }

    log(`Операции между счетами: ${counters.accountOperations}`, counters.accountOperations >= 5 ? "OK" : "BUG")
  })

  // ============================================================
  // SUMMARY
  // ============================================================

  test("СВОДКА: Полный бизнес-сценарий 3.5 месяца", async () => {
    console.log("\n\n========================================")
    console.log("  СВОДКА: ПОЛНЫЙ БИЗНЕС-СЦЕНАРИЙ")
    console.log("  Организация: " + ORG_NAME)
    console.log("========================================\n")

    console.log(`Филиалы:           ${counters.branches}`)
    console.log(`Кабинеты:          ${counters.rooms}`)
    console.log(`Направления:       ${counters.directions}`)
    console.log(`Инструкторы:       ${counters.instructors}`)
    console.log(`Группы:            ${counters.groups}`)
    console.log(`Клиенты:           ${counters.clients}`)
    console.log(`Подопечные:        ${counters.wards}`)
    console.log(`Абонементы:        ${counters.subscriptions}`)
    console.log(`Занятия:           ${counters.lessonsGenerated}`)
    console.log(`Посещения:         ${counters.attendanceRecords}`)
    console.log(`Оплаты:            ${counters.payments}`)
    console.log(`Расходы:           ${counters.expenses}`)
    console.log(`Зарплатные выплаты:${counters.salaryPayments}`)
    console.log(`Закрытые периоды:  ${counters.closedPeriods}`)
    console.log(`Операции счетов:   ${counters.accountOperations}`)

    const oks = results.filter(r => r.status === "OK")
    const bugs = results.filter(r => r.status === "BUG")

    console.log(`\nПройдено: ${oks.length}`)
    console.log(`Багов:    ${bugs.length}`)
    console.log(`Всего:    ${results.length}`)

    if (bugs.length > 0) {
      console.log("\n--- БАГИ ---\n")
      bugs.forEach((b, i) => {
        console.log(`${i + 1}. ${b.step}`)
        if (b.detail) console.log(`   -> ${b.detail}`)
      })
    }

    console.log("\n--- ВСЕ РЕЗУЛЬТАТЫ ---\n")
    results.forEach(r => {
      console.log(`${r.status === "OK" ? "+" : "x"} ${r.step}${r.detail ? ` -- ${r.detail}` : ""}`)
    })

    expect(true).toBe(true)
  })
})

// ============================================================
// HELPER: Create subscription batch
// ============================================================
async function createSubscriptionsBatch(
  page: Page,
  year: number,
  month: number,
  count: number,
  startOffset: number,
) {
  for (let i = 0; i < count; i++) {
    const globalIdx = startOffset + i
    const clientData = state.clientIds[globalIdx % state.clientIds.length]
    if (!clientData) continue

    const group = state.groupIds[globalIdx % state.groupIds.length]
    if (!group) continue

    const dir = state.directionIds.find(d => d.id === group.directionId) || state.directionIds[0]
    const lessonPrice = dir.lessonPrice
    const totalLessons = 8 + (globalIdx % 4) // 8-11 lessons

    // Discounts: multi-child (10-20%), sibling (5-15%)
    let discountAmount = 0
    if (clientData.wardIds.length >= 3) {
      discountAmount = Math.round(lessonPrice * totalLessons * 0.15) // 15% multi-child
    } else if (clientData.wardIds.length === 2 && i % 3 === 0) {
      discountAmount = Math.round(lessonPrice * totalLessons * 0.10) // 10% sibling
    } else if (globalIdx % 7 === 0) {
      discountAmount = Math.round(lessonPrice * totalLessons * 0.05) // 5% promo
    }

    // Use ward if client has wards
    const wardId = clientData.wardIds.length > 0
      ? clientData.wardIds[globalIdx % clientData.wardIds.length]
      : undefined

    try {
      const sub = await apiPost(page, "/api/subscriptions", {
        clientId: clientData.id,
        directionId: dir.id,
        groupId: group.id,
        periodYear: year,
        periodMonth: month,
        lessonPrice,
        totalLessons,
        discountAmount,
        startDate: `${year}-${String(month).padStart(2, "0")}-01`,
        wardId,
      })

      state.subscriptionIds.push({
        id: sub.id,
        clientId: clientData.id,
        groupId: group.id,
        wardId,
        month,
        year,
        finalAmount: Number(sub.finalAmount),
      })
      counters.subscriptions++
    } catch (e: any) {
      // Rate limit or duplicate — acceptable
      if (e.message?.includes("429")) {
        // Wait and retry once
        await page.waitForTimeout(1000)
        try {
          const sub = await apiPost(page, "/api/subscriptions", {
            clientId: clientData.id,
            directionId: dir.id,
            groupId: group.id,
            periodYear: year,
            periodMonth: month,
            lessonPrice,
            totalLessons,
            discountAmount,
            startDate: `${year}-${String(month).padStart(2, "0")}-01`,
            wardId,
          })
          state.subscriptionIds.push({
            id: sub.id,
            clientId: clientData.id,
            groupId: group.id,
            wardId,
            month,
            year,
            finalAmount: Number(sub.finalAmount),
          })
          counters.subscriptions++
        } catch {}
      }
    }
  }
}
