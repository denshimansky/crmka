import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const db = new PrismaClient()
const hash = (pwd: string) => bcrypt.hashSync(pwd, 10)

// ============================================================
// HELPERS
// ============================================================

/** Returns all Date objects in a month matching given weekdays (1=Mon..7=Sun) */
function daysInMonth(year: number, month: number, daysOfWeek: number[]): Date[] {
  const results: Date[] = []
  const daysInM = new Date(year, month, 0).getDate()
  for (let d = 1; d <= daysInM; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d))
    let dow = dt.getUTCDay() // 0=Sun
    if (dow === 0) dow = 7
    if (daysOfWeek.includes(dow)) results.push(dt)
  }
  return results
}

/** Deterministic attendance type index based on student+lesson indices */
function attendanceTypeIndex(studentIdx: number, lessonIdx: number, presentRate: number): string {
  const v = ((studentIdx * 31 + lessonIdx * 17) % 100)
  if (v < presentRate) return "present"
  if (v < presentRate + 10) return "absent_excused"
  if (v < presentRate + 18) return "absent_unexcused"
  if (v < presentRate + 23) return "sick"
  return "makeup"
}

/** Deterministic payment method */
function paymentMethod(idx: number): { method: "cash" | "bank_transfer" | "acquiring", accountKey: string } {
  const v = idx % 10
  if (v < 7) return { method: "cash", accountKey: "branch" }
  if (v < 9) return { method: "acquiring", accountKey: "acquiring" }
  return { method: "bank_transfer", accountKey: "bank" }
}

/** Deterministic channel */
function channelForLead(idx: number): string {
  const channels = ["Инстаграм", "Инстаграм", "Инстаграм", "Сарафанное радио", "Сарафанное радио",
    "Авито", "Авито", "Листовки", "Листовки", "Сайт"]
  return channels[idx % channels.length]
}

// ============================================================
// STEP 0: BACKOFFICE
// ============================================================
async function step0_backoffice() {
  console.log("\n=== STEP 0: Backoffice ===")

  const admin = await db.adminUser.upsert({
    where: { email: "admin@umnayacrm.ru" },
    update: {},
    create: {
      email: "admin@umnayacrm.ru",
      passwordHash: hash("admin123"),
      name: "Суперадмин",
      role: "superadmin",
    },
  })
  console.log("  AdminUser created:", admin.email)

  const planStandard = await db.billingPlan.create({
    data: { name: "Стандарт", pricePerBranch: 5000, description: "5 000 ₽/мес за филиал" },
  })
  const planPremium = await db.billingPlan.create({
    data: { name: "Премиум", pricePerBranch: 8000, description: "8 000 ₽/мес за филиал" },
  })
  console.log("  BillingPlans created: Стандарт, Премиум")

  const org = await db.organization.create({
    data: {
      name: 'Детский центр «Умные дети»',
      legalName: "ИП Соколова Т.В.",
      inn: "7723456789",
      phone: "+7 (999) 200-00-01",
      email: "info@umnyedeti.ru",
      contactPerson: "Соколова Татьяна Владимировна",
      salaryDay1: 15,
      salaryDay2: 30,
      payForAbsence: false,
      attendanceDeadline: 14,
    },
  })
  console.log("  Organization created:", org.name)

  const sub = await db.billingSubscription.create({
    data: {
      organizationId: org.id,
      planId: planStandard.id,
      status: "active",
      branchCount: 2,
      monthlyAmount: 10000,
      startDate: new Date("2026-01-01"),
      nextPaymentDate: new Date("2026-04-01"),
    },
  })

  // Invoices: Jan paid, Feb paid, Mar pending
  await db.billingInvoice.create({
    data: {
      subscriptionId: sub.id, organizationId: org.id, number: "INV-2026-001",
      amount: 10000, status: "paid", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31"),
      dueDate: new Date("2026-01-05"), paidAt: new Date("2026-01-03"), paidAmount: 10000,
    },
  })
  await db.billingInvoice.create({
    data: {
      subscriptionId: sub.id, organizationId: org.id, number: "INV-2026-002",
      amount: 10000, status: "paid", periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28"),
      dueDate: new Date("2026-02-05"), paidAt: new Date("2026-02-03"), paidAmount: 10000,
    },
  })
  await db.billingInvoice.create({
    data: {
      subscriptionId: sub.id, organizationId: org.id, number: "INV-2026-003",
      amount: 10000, status: "pending", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31"),
      dueDate: new Date("2026-03-05"),
    },
  })
  console.log("  BillingInvoices created: 3")

  return { org, planStandard, planPremium }
}

// ============================================================
// STEP 1: ORGANIZATION SETUP
// ============================================================
async function step1_setup(org: { id: string }) {
  console.log("\n=== STEP 1: Organization Setup ===")
  const T = org.id

  // --- Branches ---
  const brAkad = await db.branch.create({
    data: { tenantId: T, name: "Академический", address: "ул. Пушкина, 28", workingHoursStart: "08:00", workingHoursEnd: "21:00", workingDays: [1, 2, 3, 4, 5, 6] },
  })
  const brPark = await db.branch.create({
    data: { tenantId: T, name: "Парковый", address: "пр-т Победы, 7", workingHoursStart: "08:00", workingHoursEnd: "21:00", workingDays: [1, 2, 3, 4, 5, 6] },
  })
  console.log("  Branches: Академический, Парковый")

  // --- Rooms ---
  const roomsAkad = await Promise.all([
    db.room.create({ data: { tenantId: T, branchId: brAkad.id, name: "Большой зал", capacity: 15 } }),
    db.room.create({ data: { tenantId: T, branchId: brAkad.id, name: "Малый зал", capacity: 10 } }),
    db.room.create({ data: { tenantId: T, branchId: brAkad.id, name: "Класс", capacity: 8 } }),
    db.room.create({ data: { tenantId: T, branchId: brAkad.id, name: "Мастерская", capacity: 12 } }),
  ])
  const [bigHall, smallHall, classroom, workshop] = roomsAkad

  const roomsPark = await Promise.all([
    db.room.create({ data: { tenantId: T, branchId: brPark.id, name: "Зал", capacity: 12 } }),
    db.room.create({ data: { tenantId: T, branchId: brPark.id, name: "Кабинет 1", capacity: 8 } }),
    db.room.create({ data: { tenantId: T, branchId: brPark.id, name: "Кабинет 2", capacity: 8 } }),
  ])
  const [hallPark, cab1, cab2] = roomsPark
  console.log("  Rooms: 4 (Акад) + 3 (Парк)")

  // --- Directions ---
  const dirs = await Promise.all([
    db.direction.create({ data: { tenantId: T, name: "Робототехника", lessonPrice: 800, lessonDuration: 60, trialFree: true, color: "#3B82F6", sortOrder: 1 } }),
    db.direction.create({ data: { tenantId: T, name: "Английский язык", lessonPrice: 700, lessonDuration: 45, trialPrice: 300, trialFree: false, color: "#10B981", sortOrder: 2 } }),
    db.direction.create({ data: { tenantId: T, name: "Рисование", lessonPrice: 600, lessonDuration: 60, trialFree: true, color: "#F59E0B", sortOrder: 3 } }),
    db.direction.create({ data: { tenantId: T, name: "Танцы", lessonPrice: 650, lessonDuration: 60, trialFree: true, color: "#EC4899", sortOrder: 4 } }),
    db.direction.create({ data: { tenantId: T, name: "Подготовка к школе", lessonPrice: 900, lessonDuration: 60, trialPrice: 500, trialFree: false, color: "#8B5CF6", sortOrder: 5 } }),
    db.direction.create({ data: { tenantId: T, name: "Шахматы", lessonPrice: 500, lessonDuration: 45, trialFree: true, color: "#6366F1", sortOrder: 6 } }),
    db.direction.create({ data: { tenantId: T, name: "Логопед", lessonPrice: 1200, lessonDuration: 30, trialFree: true, color: "#EF4444", sortOrder: 7 } }),
  ])
  const [dRobo, dEng, dArt, dDance, dPrep, dChess, dLogo] = dirs
  console.log("  Directions: 7")

  // --- Staff ---
  const owner = await db.employee.create({
    data: { tenantId: T, login: "owner", passwordHash: hash("demo123"), email: "owner@umnayacrm.ru", firstName: "Татьяна", lastName: "Соколова", role: "owner" },
  })
  const manager = await db.employee.create({
    data: { tenantId: T, login: "manager", passwordHash: hash("demo123"), firstName: "Игорь", lastName: "Белов", role: "manager" },
  })
  const admin1 = await db.employee.create({
    data: { tenantId: T, login: "admin", passwordHash: hash("demo123"), firstName: "Светлана", lastName: "Козлова", role: "admin" },
  })
  const admin2 = await db.employee.create({
    data: { tenantId: T, login: "admin2", passwordHash: hash("demo123"), firstName: "Елена", lastName: "Морозова", role: "admin" },
  })
  const instOlga = await db.employee.create({
    data: { tenantId: T, login: "instructor", passwordHash: hash("demo123"), firstName: "Ольга", lastName: "Петрова", role: "instructor" },
  })
  const instSergey = await db.employee.create({
    data: { tenantId: T, login: "inst2", passwordHash: hash("demo123"), firstName: "Сергей", lastName: "Волков", role: "instructor" },
  })
  const instKaterina = await db.employee.create({
    data: { tenantId: T, login: "inst3", passwordHash: hash("demo123"), firstName: "Катерина", lastName: "Новикова", role: "instructor" },
  })
  const instDmitriy = await db.employee.create({
    data: { tenantId: T, login: "inst4", passwordHash: hash("demo123"), firstName: "Дмитрий", lastName: "Соколов", role: "instructor" },
  })
  const instMaria = await db.employee.create({
    data: { tenantId: T, login: "inst5", passwordHash: hash("demo123"), firstName: "Мария", lastName: "Фёдорова", role: "instructor" },
  })
  const instAlexey = await db.employee.create({
    data: { tenantId: T, login: "inst6", passwordHash: hash("demo123"), firstName: "Алексей", lastName: "Кузнецов", role: "instructor" },
  })
  const instIrina = await db.employee.create({
    data: { tenantId: T, login: "inst7", passwordHash: hash("demo123"), firstName: "Ирина", lastName: "Лебедева", role: "instructor" },
  })
  const instPavel = await db.employee.create({
    data: { tenantId: T, login: "inst8", passwordHash: hash("demo123"), firstName: "Павел", lastName: "Жуков", role: "instructor" },
  })
  const instNatalya = await db.employee.create({
    data: { tenantId: T, login: "inst9", passwordHash: hash("demo123"), firstName: "Наталья", lastName: "Сидорова", role: "instructor" },
  })
  const viewer = await db.employee.create({
    data: { tenantId: T, login: "viewer", passwordHash: hash("demo123"), firstName: "Пётр", lastName: "Иванов", role: "readonly" },
  })
  console.log("  Staff: 14")

  // User for owner (NextAuth)
  await db.user.create({
    data: { email: owner.email, name: "Соколова Татьяна", employeeId: owner.id },
  })

  // --- EmployeeBranch ---
  const ebData = [
    { tenantId: T, employeeId: admin1.id, branchId: brAkad.id },
    { tenantId: T, employeeId: admin2.id, branchId: brPark.id },
    { tenantId: T, employeeId: instOlga.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instSergey.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instKaterina.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instKaterina.id, branchId: brPark.id },
    { tenantId: T, employeeId: instDmitriy.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instMaria.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instMaria.id, branchId: brPark.id },
    { tenantId: T, employeeId: instAlexey.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instIrina.id, branchId: brPark.id },
    { tenantId: T, employeeId: instPavel.id, branchId: brPark.id },
    { tenantId: T, employeeId: instNatalya.id, branchId: brAkad.id },
    { tenantId: T, employeeId: instNatalya.id, branchId: brPark.id },
  ]
  await db.employeeBranch.createMany({ data: ebData })
  console.log("  EmployeeBranch: " + ebData.length)

  // --- Financial accounts ---
  const accCashAkad = await db.financialAccount.create({
    data: { tenantId: T, name: "Касса Академический", type: "cash", branchId: brAkad.id },
  })
  const accCashPark = await db.financialAccount.create({
    data: { tenantId: T, name: "Касса Парковый", type: "cash", branchId: brPark.id },
  })
  const accBank = await db.financialAccount.create({
    data: { tenantId: T, name: "Расчётный счёт", type: "bank_account" },
  })
  const accAcq = await db.financialAccount.create({
    data: { tenantId: T, name: "Эквайринг", type: "acquiring" },
  })
  console.log("  Financial accounts: 4")

  // --- Expense categories ---
  const catNames = [
    { name: "Аренда", isSalary: false, isVariable: false, sortOrder: 1 },
    { name: "Коммунальные", isSalary: false, isVariable: false, sortOrder: 2 },
    { name: "Интернет", isSalary: false, isVariable: false, sortOrder: 3 },
    { name: "Маркетинг", isSalary: false, isVariable: false, sortOrder: 4 },
    { name: "Канцтовары", isSalary: false, isVariable: true, sortOrder: 5 },
    { name: "Хозтовары", isSalary: false, isVariable: true, sortOrder: 6 },
    { name: "Ремонт", isSalary: false, isVariable: false, sortOrder: 7 },
    { name: "Зарплата", isSalary: true, isVariable: true, sortOrder: 8 },
    { name: "Налоги", isSalary: false, isVariable: false, sortOrder: 9 },
    { name: "Прочее", isSalary: false, isVariable: false, sortOrder: 10 },
  ]
  const cats: Record<string, string> = {}
  for (const c of catNames) {
    const cat = await db.expenseCategory.create({
      data: { tenantId: T, name: c.name, isSalary: c.isSalary, isVariable: c.isVariable, isSystem: true, sortOrder: c.sortOrder },
    })
    cats[c.name] = cat.id
  }
  console.log("  ExpenseCategories: 10")

  // --- Attendance types ---
  const atTypes = [
    { name: "Присутствие", code: "present", chargesSubscription: true, paysInstructor: true, countsAsRevenue: true, sortOrder: 1 },
    { name: "Уваж. пропуск", code: "absent_excused", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 2 },
    { name: "Неуваж. пропуск", code: "absent_unexcused", chargesSubscription: true, paysInstructor: false, countsAsRevenue: true, sortOrder: 3 },
    { name: "Пробное", code: "trial", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 4 },
    { name: "Отработка", code: "makeup", chargesSubscription: true, paysInstructor: true, countsAsRevenue: true, sortOrder: 5 },
    { name: "Перерасчёт", code: "recalc", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 6 },
    { name: "Болезнь", code: "sick", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 7 },
  ]
  const attTypeMap: Record<string, { id: string; charges: boolean; pays: boolean; revenue: boolean }> = {}
  for (const at of atTypes) {
    const created = await db.attendanceType.create({
      data: { tenantId: T, name: at.name, code: at.code, chargesSubscription: at.chargesSubscription, paysInstructor: at.paysInstructor, countsAsRevenue: at.countsAsRevenue, isSystem: true, sortOrder: at.sortOrder },
    })
    attTypeMap[at.code] = { id: created.id, charges: at.chargesSubscription, pays: at.paysInstructor, revenue: at.countsAsRevenue }
  }
  console.log("  AttendanceTypes: 7")

  // --- Salary rates ---
  const salaryRatesDef: { empId: string; dirId: string; rate: number }[] = [
    { empId: instSergey.id, dirId: dRobo.id, rate: 350 },
    { empId: instOlga.id, dirId: dEng.id, rate: 300 },
    { empId: instKaterina.id, dirId: dArt.id, rate: 250 },
    { empId: instDmitriy.id, dirId: dDance.id, rate: 300 },
    { empId: instMaria.id, dirId: dPrep.id, rate: 400 },
    { empId: instAlexey.id, dirId: dChess.id, rate: 250 },
    { empId: instIrina.id, dirId: dEng.id, rate: 300 },
    { empId: instPavel.id, dirId: dRobo.id, rate: 350 },
    { empId: instPavel.id, dirId: dDance.id, rate: 300 },
    { empId: instNatalya.id, dirId: dLogo.id, rate: 500 },
  ]
  const salaryRates: Record<string, number> = {}
  for (const sr of salaryRatesDef) {
    const created = await db.salaryRate.create({
      data: { tenantId: T, employeeId: sr.empId, directionId: sr.dirId, scheme: "per_student", ratePerStudent: sr.rate },
    })
    salaryRates[`${sr.empId}_${sr.dirId}`] = sr.rate
  }
  console.log("  SalaryRates: " + salaryRatesDef.length)

  // --- Groups (18) ---
  type GroupDef = {
    name: string; dirId: string; branchId: string; roomId: string; instId: string; max: number;
    days: number[]; time: string; duration: number
  }
  const groupDefs: GroupDef[] = [
    // Академический (11)
    { name: "Робототехника Пн/Ср 10:00", dirId: dRobo.id, branchId: brAkad.id, roomId: bigHall.id, instId: instSergey.id, max: 12, days: [1, 3], time: "10:00", duration: 60 },
    { name: "Робототехника Вт/Чт 16:00", dirId: dRobo.id, branchId: brAkad.id, roomId: bigHall.id, instId: instSergey.id, max: 12, days: [2, 4], time: "16:00", duration: 60 },
    { name: "Английский Пн/Ср/Пт 11:00", dirId: dEng.id, branchId: brAkad.id, roomId: classroom.id, instId: instOlga.id, max: 8, days: [1, 3, 5], time: "11:00", duration: 45 },
    { name: "Английский Вт/Чт 17:00", dirId: dEng.id, branchId: brAkad.id, roomId: classroom.id, instId: instOlga.id, max: 8, days: [2, 4], time: "17:00", duration: 45 },
    { name: "Рисование Пн/Ср 14:00", dirId: dArt.id, branchId: brAkad.id, roomId: workshop.id, instId: instKaterina.id, max: 10, days: [1, 3], time: "14:00", duration: 60 },
    { name: "Танцы Вт/Чт/Сб 15:00", dirId: dDance.id, branchId: brAkad.id, roomId: smallHall.id, instId: instDmitriy.id, max: 12, days: [2, 4, 6], time: "15:00", duration: 60 },
    { name: "Подготовка Пн/Ср/Пт 09:00", dirId: dPrep.id, branchId: brAkad.id, roomId: classroom.id, instId: instMaria.id, max: 8, days: [1, 3, 5], time: "09:00", duration: 60 },
    { name: "Подготовка Вт/Чт 10:00", dirId: dPrep.id, branchId: brAkad.id, roomId: smallHall.id, instId: instMaria.id, max: 8, days: [2, 4], time: "10:00", duration: 60 },
    { name: "Шахматы Сб 12:00", dirId: dChess.id, branchId: brAkad.id, roomId: classroom.id, instId: instAlexey.id, max: 8, days: [6], time: "12:00", duration: 45 },
    { name: "Шахматы Вс 12:00", dirId: dChess.id, branchId: brAkad.id, roomId: classroom.id, instId: instAlexey.id, max: 8, days: [7], time: "12:00", duration: 45 },
    { name: "Логопед Пн/Ср/Пт 16:00", dirId: dLogo.id, branchId: brAkad.id, roomId: classroom.id, instId: instNatalya.id, max: 4, days: [1, 3, 5], time: "16:00", duration: 30 },
    // Парковый (7)
    { name: "Робототехника Пн/Ср 16:00", dirId: dRobo.id, branchId: brPark.id, roomId: hallPark.id, instId: instPavel.id, max: 10, days: [1, 3], time: "16:00", duration: 60 },
    { name: "Английский Вт/Чт 15:00", dirId: dEng.id, branchId: brPark.id, roomId: cab1.id, instId: instIrina.id, max: 8, days: [2, 4], time: "15:00", duration: 45 },
    { name: "Танцы Пт/Сб 17:00", dirId: dDance.id, branchId: brPark.id, roomId: hallPark.id, instId: instPavel.id, max: 10, days: [5, 6], time: "17:00", duration: 60 },
    { name: "Рисование Вт/Чт 14:00", dirId: dArt.id, branchId: brPark.id, roomId: cab2.id, instId: instKaterina.id, max: 8, days: [2, 4], time: "14:00", duration: 60 },
    { name: "Английский Пн/Ср 10:00", dirId: dEng.id, branchId: brPark.id, roomId: cab1.id, instId: instIrina.id, max: 8, days: [1, 3], time: "10:00", duration: 45 },
    { name: "Подготовка Пн/Ср/Пт 11:00", dirId: dPrep.id, branchId: brPark.id, roomId: cab2.id, instId: instMaria.id, max: 8, days: [1, 3, 5], time: "11:00", duration: 60 },
    { name: "Логопед Вт/Чт 16:00", dirId: dLogo.id, branchId: brPark.id, roomId: cab1.id, instId: instNatalya.id, max: 4, days: [2, 4], time: "16:00", duration: 30 },
  ]

  const groups: { id: string; def: GroupDef }[] = []
  for (const gd of groupDefs) {
    const g = await db.group.create({
      data: { tenantId: T, name: gd.name, directionId: gd.dirId, branchId: gd.branchId, roomId: gd.roomId, instructorId: gd.instId, maxStudents: gd.max },
    })
    groups.push({ id: g.id, def: gd })
  }
  console.log("  Groups: " + groups.length)

  // --- Schedule templates ---
  for (const g of groups) {
    for (const dow of g.def.days) {
      await db.groupScheduleTemplate.create({
        data: { tenantId: T, groupId: g.id, dayOfWeek: dow, startTime: g.def.time, durationMinutes: g.def.duration, effectiveFrom: new Date("2026-01-01") },
      })
    }
  }
  console.log("  ScheduleTemplates created")

  // --- Discount templates ---
  await db.discountTemplate.createMany({
    data: [
      { tenantId: T, name: "Многодетные", type: "permanent", valueType: "percent", value: 10, isStackable: true },
      { tenantId: T, name: "Второй ребёнок", type: "linked", valueType: "percent", value: 15, isStackable: true },
      { tenantId: T, name: "Акция записи", type: "one_time", valueType: "fixed", value: 500, isStackable: false },
    ],
  })
  console.log("  DiscountTemplates: 3")

  // --- Admin bonus settings ---
  for (const empId of [admin1.id, admin2.id]) {
    for (const bt of [{ type: "per_trial" as const, amount: 200 }, { type: "per_sale" as const, amount: 500 }, { type: "per_upsale" as const, amount: 300 }]) {
      await db.adminBonusSettings.create({
        data: { tenantId: T, employeeId: empId, bonusType: bt.type, amount: bt.amount },
      })
    }
  }
  console.log("  AdminBonusSettings: 6")

  return {
    T, brAkad, brPark, owner, manager, admin1, admin2,
    instOlga, instSergey, instKaterina, instDmitriy, instMaria, instAlexey, instIrina, instPavel, instNatalya, viewer,
    dirs, dRobo, dEng, dArt, dDance, dPrep, dChess, dLogo,
    groups, groupDefs,
    accCashAkad, accCashPark, accBank, accAcq,
    cats, attTypeMap, salaryRates,
  }
}

// ============================================================
// STEP 2: JANUARY
// ============================================================
async function step2_january(ctx: Awaited<ReturnType<typeof step1_setup>>) {
  console.log("\n=== STEP 2: January 2026 ===")
  const { T, brAkad, brPark, owner, admin1, admin2, groups, attTypeMap, cats, accCashAkad, accCashPark, accBank, accAcq } = ctx

  // Lead names
  const leadNames = [
    { first: "Мария", last: "Антонова" }, { first: "Алексей", last: "Березин" }, { first: "Елена", last: "Виноградова" },
    { first: "Сергей", last: "Григорьев" }, { first: "Ольга", last: "Дмитриева" }, { first: "Андрей", last: "Егоров" },
    { first: "Наталья", last: "Жукова" }, { first: "Павел", last: "Зайцев" }, { first: "Анна", last: "Ильина" },
    { first: "Светлана", last: "Крылова" }, { first: "Дмитрий", last: "Лисицын" }, { first: "Ирина", last: "Михайлова" },
    { first: "Артём", last: "Носов" }, { first: "Юлия", last: "Орлова" }, { first: "Роман", last: "Павлов" },
    { first: "Дарья", last: "Русакова" }, { first: "Иван", last: "Сафронов" }, { first: "Екатерина", last: "Тарасова" },
    { first: "Вера", last: "Ушакова" }, { first: "Максим", last: "Филиппов" }, { first: "Марина", last: "Хорошева" },
    { first: "Галина", last: "Цветкова" }, { first: "Полина", last: "Чернова" }, { first: "Людмила", last: "Шестакова" },
    { first: "Оксана", last: "Яковлева" },
    { first: "Татьяна", last: "Белякова" }, { first: "Виктор", last: "Голубев" }, { first: "Елизавета", last: "Давыдова" },
    { first: "Олег", last: "Ефремов" }, { first: "Кристина", last: "Зимина" }, { first: "Николай", last: "Калашников" },
    { first: "Алина", last: "Лаврова" }, { first: "Тимур", last: "Макаров" }, { first: "Валентина", last: "Никитина" },
    { first: "Денис", last: "Осипов" }, { first: "Юлиана", last: "Панова" }, { first: "Степан", last: "Рябов" },
    { first: "Софья", last: "Степанова" }, { first: "Артур", last: "Тихонов" }, { first: "Надежда", last: "Ульянова" },
    { first: "Георгий", last: "Федотов" }, { first: "Лариса", last: "Харитонова" }, { first: "Борис", last: "Чистяков" },
    { first: "Ангелина", last: "Широкова" }, { first: "Руслан", last: "Щербаков" },
  ]

  const childNames = [
    "Миша", "Аня", "Саша", "Даня", "Соня", "Артём", "Лиза", "Матвей", "Ева", "Кира",
    "Тимофей", "Алиса", "Максим", "Полина", "Егор", "Варвара", "Никита", "Мила", "Роман", "Ульяна",
    "Марк", "Вероника", "Лев", "Дарина", "Глеб",
  ]

  // Create 45 leads. First 25 → convert, 26-28 → potential, 29-30 → non_target, rest stay in funnel
  const clients: { id: string; wardId: string; branchId: string; idx: number }[] = []
  const allClientIds: string[] = []

  for (let i = 0; i < 45; i++) {
    const ln = leadNames[i]
    const channel = channelForLead(i)
    const brId = i % 3 === 0 ? brPark.id : brAkad.id
    const phone = `+7 (9${String(10 + i).padStart(2, "0")}) ${String(100 + i * 3).padStart(3, "0")}-${String(20 + i * 2).padStart(2, "0")}-${String(10 + i).padStart(2, "0")}`

    let funnelStatus: "new" | "trial_scheduled" | "trial_attended" | "awaiting_payment" | "active_client" | "potential" | "non_target"
    let clientStatus: "active" | null = null

    if (i < 25) {
      funnelStatus = "active_client"
      clientStatus = "active"
    } else if (i < 28) {
      funnelStatus = "potential"
    } else if (i < 30) {
      funnelStatus = "non_target"
    } else if (i < 32) {
      funnelStatus = "trial_attended"
    } else if (i < 35) {
      funnelStatus = "trial_scheduled"
    } else {
      funnelStatus = "new"
    }

    const createdDate = new Date(Date.UTC(2026, 0, 3 + (i % 15)))
    const client = await db.client.create({
      data: {
        tenantId: T, firstName: ln.first, lastName: ln.last,
        phone, funnelStatus, clientStatus,
        segment: i < 25 ? "new_client" : "new_client",
        branchId: brId,
        comment: `Канал: ${channel}`,
        createdAt: createdDate,
        firstPaymentDate: i < 25 ? new Date(Date.UTC(2026, 0, 5 + (i % 11))) : undefined,
        saleDate: i < 25 ? new Date(Date.UTC(2026, 0, 5 + (i % 11))) : undefined,
      },
    })
    allClientIds.push(client.id)

    if (i < 25) {
      const ward = await db.ward.create({
        data: { tenantId: T, clientId: client.id, firstName: childNames[i], birthDate: new Date(Date.UTC(2019 + (i % 4), i % 12, 1 + (i % 28))) },
      })
      clients.push({ id: client.id, wardId: ward.id, branchId: brId, idx: i })
    }
  }
  console.log("  Leads/Clients: 45 (25 converted)")

  // --- Trial lessons for first 32 leads ---
  const trialGroupIdx = [0, 2, 4, 6, 1, 3, 5, 7, 11, 12, 13, 14, 0, 2, 4, 6, 1, 3, 5, 7, 11, 12, 13, 14, 0, 2, 4, 6, 1, 3, 5, 7]
  for (let i = 0; i < 32; i++) {
    const gIdx = trialGroupIdx[i % trialGroupIdx.length]
    let status: "attended" | "no_show" | "cancelled" | "scheduled"
    if (i < 25) status = "attended"
    else if (i < 28) status = "attended"
    else if (i < 31) status = "no_show"
    else status = "cancelled"

    await db.trialLesson.create({
      data: {
        tenantId: T, clientId: allClientIds[i], groupId: groups[gIdx].id,
        status, scheduledDate: new Date(Date.UTC(2026, 0, 6 + (i % 15))),
        attendedAt: status === "attended" ? new Date(Date.UTC(2026, 0, 6 + (i % 15))) : undefined,
      },
    })
  }
  console.log("  TrialLessons: 32")

  // --- Subscriptions (50 for January) ---
  // 25 clients, some get 2 directions
  type SubRecord = { id: string; clientId: string; wardId: string; groupIdx: number; dirId: string; price: number; totalLessons: number }
  const janSubs: SubRecord[] = []

  // Group assignment: distribute clients across groups
  const clientGroupAssignments: { clientIdx: number; groupIdx: number }[] = []
  // First direction for each of 25 clients
  const primaryGroupAssign = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6, 1, 3, 5, 11, 12, 17]
  for (let i = 0; i < 25; i++) {
    clientGroupAssignments.push({ clientIdx: i, groupIdx: primaryGroupAssign[i] })
  }
  // Second direction for 25 clients (every other gets a 2nd direction = ~12-13 more subs, total ~37-38, we need 50 so add more)
  const secondGroupAssign = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15, 3, 0, 1, 16, 17, 6, 5, 9, 14, 15, 12, 11, 4]
  for (let i = 0; i < 25; i++) {
    clientGroupAssignments.push({ clientIdx: i, groupIdx: secondGroupAssign[i] })
  }
  // Total: 50 subscriptions

  // Discount tracking: indices 3,7,15 get multi-child 10%, indices 5,10 get one-time 500₽
  const discountClients10pct = new Set([3, 7, 15])
  const discountClients500 = new Set([5, 10])

  for (let si = 0; si < clientGroupAssignments.length; si++) {
    const ca = clientGroupAssignments[si]
    const cl = clients[ca.clientIdx]
    const g = groups[ca.groupIdx]
    const gd = g.def

    // Direction price
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)

    // Count lessons in January for this group
    const janDates = daysInMonth(2026, 1, gd.days)
    const totalLessons = janDates.length
    const totalAmount = totalLessons * price

    let discountAmount = 0
    if (si < 25 && discountClients10pct.has(ca.clientIdx)) {
      discountAmount = Math.round(totalAmount * 0.1)
    } else if (si < 25 && discountClients500.has(ca.clientIdx)) {
      discountAmount = 500
    }
    const finalAmount = totalAmount - discountAmount

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId: cl.id, wardId: cl.wardId, directionId: gd.dirId, groupId: g.id,
        type: "calendar", status: "closed",
        periodYear: 2026, periodMonth: 1,
        lessonPrice: price, totalLessons, totalAmount, discountAmount, finalAmount,
        balance: 0, chargedAmount: finalAmount,
        startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"),
        activatedAt: new Date(Date.UTC(2026, 0, 5 + (ca.clientIdx % 11))),
        createdBy: owner.id,
      },
    })
    janSubs.push({ id: sub.id, clientId: cl.id, wardId: cl.wardId, groupIdx: ca.groupIdx, dirId: gd.dirId, price, totalLessons })

    // Create discount record
    if (discountAmount > 0) {
      await db.discount.create({
        data: {
          tenantId: T, subscriptionId: sub.id,
          type: discountClients10pct.has(ca.clientIdx) ? "permanent" : "one_time",
          valueType: discountClients10pct.has(ca.clientIdx) ? "percent" : "fixed",
          value: discountClients10pct.has(ca.clientIdx) ? 10 : 500,
          calculatedAmount: discountAmount,
          comment: discountClients10pct.has(ca.clientIdx) ? "Многодетная семья" : "Акция записи",
          startDate: new Date("2026-01-01"),
          createdBy: owner.id,
        },
      })
    }
  }
  console.log("  Subscriptions (Jan): " + janSubs.length)

  // --- Group enrollments ---
  for (const sub of janSubs) {
    await db.groupEnrollment.create({
      data: {
        tenantId: T, groupId: groups[sub.groupIdx].id, clientId: sub.clientId, wardId: sub.wardId,
        enrolledAt: new Date("2026-01-05"), paymentStatus: "active", isActive: true,
      },
    })
  }
  console.log("  GroupEnrollments (Jan): " + janSubs.length)

  // --- Payments ---
  const cashAccForBranch = (brId: string) => brId === brAkad.id ? accCashAkad.id : accCashPark.id
  for (let pi = 0; pi < janSubs.length; pi++) {
    const sub = janSubs[pi]
    const pm = paymentMethod(pi)
    let accountId: string
    if (pm.accountKey === "branch") {
      const gd = groups[sub.groupIdx].def
      accountId = cashAccForBranch(gd.branchId)
    } else if (pm.accountKey === "acquiring") {
      accountId = accAcq.id
    } else {
      accountId = accBank.id
    }
    const dir = ctx.dirs.find(d => d.id === sub.dirId)!
    const totalAmount = sub.totalLessons * Number(dir.lessonPrice)
    // Use finalAmount from subscription
    const subRecord = janSubs[pi]
    await db.payment.create({
      data: {
        tenantId: T, clientId: sub.clientId, subscriptionId: sub.id, accountId,
        amount: totalAmount - (pi < 25 && discountClients10pct.has(pi) ? Math.round(totalAmount * 0.1) : (pi < 25 && discountClients500.has(pi) ? 500 : 0)),
        type: "incoming", method: pm.method,
        date: new Date(Date.UTC(2026, 0, 5 + (pi % 11))),
        isFirstPayment: pi < 25, // first sub per client
        createdBy: admin1.id,
      },
    })
  }
  console.log("  Payments (Jan): " + janSubs.length)

  // --- Generate lessons for January ---
  type LessonRecord = { id: string; groupIdx: number; date: Date; instId: string }
  const janLessons: LessonRecord[] = []
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const gd = g.def
    const dates = daysInMonth(2026, 1, gd.days)
    for (const dt of dates) {
      const lesson = await db.lesson.create({
        data: {
          tenantId: T, groupId: g.id, date: dt, startTime: gd.time, durationMinutes: gd.duration,
          instructorId: gd.instId, status: "completed",
          topic: (dt.getUTCDate() % 5 === 0) ? `Тема занятия ${dt.getUTCDate()} января` : undefined,
        },
      })
      janLessons.push({ id: lesson.id, groupIdx: gi, date: dt, instId: gd.instId })
    }
  }
  console.log("  Lessons (Jan): " + janLessons.length)

  // --- Attendance ---
  let attCount = 0
  // Build enrollment map: groupIdx -> list of subs
  const enrollMap: Record<number, SubRecord[]> = {}
  for (const sub of janSubs) {
    if (!enrollMap[sub.groupIdx]) enrollMap[sub.groupIdx] = []
    enrollMap[sub.groupIdx].push(sub)
  }

  for (const lesson of janLessons) {
    const enrolled = enrollMap[lesson.groupIdx] || []
    for (let si = 0; si < enrolled.length; si++) {
      const sub = enrolled[si]
      const atCode = attendanceTypeIndex(si, lesson.date.getUTCDate(), 75)
      const atType = attTypeMap[atCode]
      if (!atType) continue

      const gd = groups[lesson.groupIdx].def
      const dir = ctx.dirs.find(d => d.id === gd.dirId)!
      const dirPrice = Number(dir.lessonPrice)
      const salaryKey = `${gd.instId}_${gd.dirId}`
      const salaryRate = ctx.salaryRates[salaryKey] || 0

      await db.attendance.create({
        data: {
          tenantId: T, lessonId: lesson.id, subscriptionId: sub.id, clientId: sub.clientId,
          attendanceTypeId: atType.id,
          chargeAmount: atType.charges ? dirPrice : 0,
          instructorPayAmount: atType.pays ? salaryRate : 0,
          instructorPayEnabled: true,
          markedAt: new Date(lesson.date),
        },
      })
      attCount++
    }
  }
  console.log("  Attendance (Jan): " + attCount)

  // --- Expenses January ---
  const janExpenses = [
    { catName: "Аренда", amount: 50000, branchId: brAkad.id, date: "2026-01-10" },
    { catName: "Аренда", amount: 40000, branchId: brPark.id, date: "2026-01-10" },
    { catName: "Коммунальные", amount: 8000, branchId: brAkad.id, date: "2026-01-15" },
    { catName: "Коммунальные", amount: 7000, branchId: brPark.id, date: "2026-01-15" },
    { catName: "Маркетинг", amount: 15000, branchId: brAkad.id, date: "2026-01-08", comment: "Инстаграм" },
    { catName: "Маркетинг", amount: 5000, branchId: brPark.id, date: "2026-01-08", comment: "Авито" },
    { catName: "Маркетинг", amount: 5000, branchId: brAkad.id, date: "2026-01-20", comment: "Листовки" },
    { catName: "Канцтовары", amount: 5000, branchId: brAkad.id, date: "2026-01-12" },
    { catName: "Канцтовары", amount: 3000, branchId: brPark.id, date: "2026-01-12" },
    { catName: "Интернет", amount: 3000, branchId: brAkad.id, date: "2026-01-05" },
    { catName: "Интернет", amount: 2000, branchId: brPark.id, date: "2026-01-05" },
  ]
  for (const exp of janExpenses) {
    const expense = await db.expense.create({
      data: {
        tenantId: T, categoryId: cats[exp.catName], accountId: accBank.id,
        amount: exp.amount, date: new Date(exp.date),
        comment: (exp as any).comment || undefined,
        createdBy: owner.id,
      },
    })
    await db.expenseBranch.create({
      data: { tenantId: T, expenseId: expense.id, branchId: exp.branchId },
    })
  }
  console.log("  Expenses (Jan): " + janExpenses.length)

  // --- Tasks ---
  const taskDefs = [
    { title: "Позвонить Антоновой — пробное", type: "auto" as const, trigger: "trial_reminder" as const, clientIdx: 0, due: "2026-01-06", status: "completed" as const },
    { title: "Оплата просрочена: Березин", type: "auto" as const, trigger: "payment_due" as const, clientIdx: 1, due: "2026-01-15", status: "completed" as const },
    { title: "День рождения подопечного: Миша", type: "auto" as const, trigger: "birthday" as const, clientIdx: 0, due: "2026-01-20", status: "pending" as const },
    { title: "Связаться с Григорьевым", type: "manual" as const, trigger: undefined, clientIdx: 3, due: "2026-01-12", status: "completed" as const },
    { title: "Пропуск 3+ занятий: Дмитриева", type: "auto" as const, trigger: "absence" as const, clientIdx: 4, due: "2026-01-22", status: "pending" as const },
    { title: "Подготовить отчёт за январь", type: "manual" as const, trigger: undefined, clientIdx: undefined, due: "2026-01-31", status: "completed" as const },
    { title: "Обещанный платёж: Егоров", type: "auto" as const, trigger: "promised_payment" as const, clientIdx: 5, due: "2026-01-18", status: "completed" as const },
    { title: "Контактная дата: Жукова", type: "auto" as const, trigger: "contact_date" as const, clientIdx: 6, due: "2026-01-25", status: "pending" as const },
    { title: "Неотмеченное занятие: Робототехника", type: "auto" as const, trigger: "unmarked_lesson" as const, clientIdx: undefined, due: "2026-01-28", status: "completed" as const },
    { title: "Проверить новые заявки", type: "manual" as const, trigger: undefined, clientIdx: undefined, due: "2026-01-30", status: "pending" as const },
  ]
  for (const td of taskDefs) {
    await db.task.create({
      data: {
        tenantId: T, title: td.title, type: td.type, autoTrigger: td.trigger,
        status: td.status, dueDate: new Date(td.due),
        assignedTo: admin1.id,
        clientId: td.clientIdx !== undefined ? allClientIds[td.clientIdx] : undefined,
        completedAt: td.status === "completed" ? new Date(td.due) : undefined,
      },
    })
  }
  console.log("  Tasks (Jan): " + taskDefs.length)

  // --- Period January (closed) ---
  await db.period.create({
    data: { tenantId: T, year: 2026, month: 1, status: "closed", closedAt: new Date("2026-02-01"), closedBy: owner.id },
  })
  console.log("  Period Jan: closed")

  return { clients, allClientIds, janSubs, janLessons, enrollMap }
}

// ============================================================
// STEP 3: FEBRUARY
// ============================================================
async function step3_february(
  ctx: Awaited<ReturnType<typeof step1_setup>>,
  janData: Awaited<ReturnType<typeof step2_january>>
) {
  console.log("\n=== STEP 3: February 2026 ===")
  const { T, brAkad, brPark, owner, admin1, admin2, groups, attTypeMap, cats, accCashAkad, accCashPark, accBank, accAcq } = ctx

  // New leads for February
  const febLeadNames = [
    { first: "Диана", last: "Абрамова" }, { first: "Владимир", last: "Баранов" }, { first: "Жанна", last: "Волошина" },
    { first: "Кирилл", last: "Гусев" }, { first: "Лилия", last: "Дорохова" }, { first: "Михаил", last: "Ермаков" },
    { first: "Оксана", last: "Журавлёва" }, { first: "Роберт", last: "Захаров" }, { first: "Светлана", last: "Игнатова" },
    { first: "Тимофей", last: "Киселёв" }, { first: "Ульяна", last: "Лазарева" }, { first: "Фёдор", last: "Мельников" },
    { first: "Христина", last: "Назарова" }, { first: "Эдуард", last: "Овчинников" }, { first: "Яна", last: "Пестова" },
    { first: "Арина", last: "Романова" }, { first: "Богдан", last: "Савельев" }, { first: "Вероника", last: "Титова" },
    { first: "Григорий", last: "Ушаков" }, { first: "Дарина", last: "Фролова" }, { first: "Егор", last: "Хлебников" },
    { first: "Зоя", last: "Цуканова" }, { first: "Игнат", last: "Черкасов" }, { first: "Карина", last: "Шабанова" },
    { first: "Леонид", last: "Щукин" }, { first: "Маргарита", last: "Юдина" }, { first: "Никита", last: "Яшин" },
    { first: "Олеся", last: "Авдеева" }, { first: "Пётр", last: "Быков" }, { first: "Регина", last: "Вишнякова" },
    { first: "Семён", last: "Горшков" }, { first: "Тамара", last: "Денисова" }, { first: "Ульян", last: "Елисеев" },
    { first: "Феликс", last: "Жданов" }, { first: "Хельга", last: "Зотова" },
  ]
  const febChildNames = [
    "Платон", "Агата", "Демид", "Злата", "Елисей", "Василиса", "Захар", "Стефания", "Богдан", "Есения",
    "Ярослав", "Таисия", "Прохор", "Милана", "Тихон", "Арина", "Савелий", "Диана", "Мирон", "Камила",
    "Назар", "Виолетта", "Макар", "Аделина", "Руслан",
  ]

  const febClients: { id: string; wardId: string; branchId: string; idx: number }[] = []
  const febAllClientIds: string[] = []

  for (let i = 0; i < 35; i++) {
    const ln = febLeadNames[i]
    const brId = i % 3 === 0 ? brPark.id : brAkad.id
    const phone = `+7 (9${String(50 + i).padStart(2, "0")}) ${String(200 + i * 3).padStart(3, "0")}-${String(30 + i).padStart(2, "0")}-${String(40 + i).padStart(2, "0")}`

    let funnelStatus: "active_client" | "potential" | "non_target" | "trial_scheduled" | "new"
    let clientStatus: "active" | null = null
    if (i < 25) { funnelStatus = "active_client"; clientStatus = "active" }
    else if (i < 28) funnelStatus = "potential"
    else if (i < 30) funnelStatus = "trial_scheduled"
    else funnelStatus = "new"

    const client = await db.client.create({
      data: {
        tenantId: T, firstName: ln.first, lastName: ln.last, phone, funnelStatus, clientStatus,
        segment: "new_client", branchId: brId,
        comment: `Канал: ${channelForLead(i + 45)}`,
        createdAt: new Date(Date.UTC(2026, 1, 1 + (i % 20))),
        firstPaymentDate: i < 25 ? new Date(Date.UTC(2026, 1, 3 + (i % 10))) : undefined,
        saleDate: i < 25 ? new Date(Date.UTC(2026, 1, 3 + (i % 10))) : undefined,
      },
    })
    febAllClientIds.push(client.id)

    if (i < 25) {
      const ward = await db.ward.create({
        data: { tenantId: T, clientId: client.id, firstName: febChildNames[i], birthDate: new Date(Date.UTC(2018 + (i % 5), (i + 3) % 12, 1 + (i % 28))) },
      })
      febClients.push({ id: client.id, wardId: ward.id, branchId: brId, idx: i })
    }
  }
  console.log("  New leads (Feb): 35 (25 converted)")

  // Churn 5 old clients
  const churnedJanClients = janData.clients.slice(20, 25)
  for (const cl of churnedJanClients) {
    await db.client.update({
      where: { id: cl.id },
      data: { clientStatus: "churned", funnelStatus: "archived", withdrawalDate: new Date("2026-02-15") },
    })
  }
  console.log("  Churned: 5 old clients")

  // Return 2 old clients
  const returningClients = janData.clients.slice(18, 20)
  for (const cl of returningClients) {
    await db.client.update({
      where: { id: cl.id },
      data: { clientStatus: "active", funnelStatus: "active_client" },
    })
  }
  console.log("  Returning: 2 old clients")

  // --- February subscriptions ---
  // Continuing Jan clients (first 20, minus 5 churned = 15 continue) + 2 returning + 25 new = 42 clients
  // ~1.5 subs per client on average → ~63 new subs. But continuing also need new subs → let's aim for ~90 total
  // Continuing clients: first 20 jan clients (indices 0-19) get new feb subs
  const febSubs: { id: string; clientId: string; wardId: string; groupIdx: number; dirId: string; price: number; totalLessons: number }[] = []

  // Continuing jan clients (0-19) — renew their first subscription
  const continuingJanSubs = janData.janSubs.filter((_s, i) => i < 20) // first sub for each of first 20 clients
  for (const oldSub of continuingJanSubs) {
    const gd = groups[oldSub.groupIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    const febDates = daysInMonth(2026, 2, gd.days)
    const totalLessons = febDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId: oldSub.clientId, wardId: oldSub.wardId, directionId: gd.dirId, groupId: groups[oldSub.groupIdx].id,
        type: "calendar", status: "closed", periodYear: 2026, periodMonth: 2,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: 0, chargedAmount: totalAmount,
        startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"),
        previousSubscriptionId: oldSub.id,
        activatedAt: new Date("2026-02-01"), createdBy: owner.id,
      },
    })
    febSubs.push({ id: sub.id, clientId: oldSub.clientId, wardId: oldSub.wardId, groupIdx: oldSub.groupIdx, dirId: gd.dirId, price, totalLessons })
  }

  // Continuing second subs (indices 25-44 of janSubs that correspond to first 20 clients)
  const secondJanSubs = janData.janSubs.filter((s, i) => i >= 25 && i < 45)
  for (const oldSub of secondJanSubs) {
    const cl = janData.clients.find(c => c.id === oldSub.clientId)
    if (!cl || cl.idx >= 20) continue // skip churned
    const gd = groups[oldSub.groupIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    const febDates = daysInMonth(2026, 2, gd.days)
    const totalLessons = febDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId: oldSub.clientId, wardId: oldSub.wardId, directionId: gd.dirId, groupId: groups[oldSub.groupIdx].id,
        type: "calendar", status: "closed", periodYear: 2026, periodMonth: 2,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: 0, chargedAmount: totalAmount,
        startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"),
        previousSubscriptionId: oldSub.id,
        activatedAt: new Date("2026-02-01"), createdBy: owner.id,
      },
    })
    febSubs.push({ id: sub.id, clientId: oldSub.clientId, wardId: oldSub.wardId, groupIdx: oldSub.groupIdx, dirId: gd.dirId, price, totalLessons })
  }

  // New Feb clients — primary subs
  const febPrimaryGroups = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6, 1, 3, 5, 11, 12, 17]
  for (let i = 0; i < 25; i++) {
    const cl = febClients[i]
    const gIdx = febPrimaryGroups[i]
    const gd = groups[gIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    const febDates = daysInMonth(2026, 2, gd.days)
    const totalLessons = febDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId: cl.id, wardId: cl.wardId, directionId: gd.dirId, groupId: groups[gIdx].id,
        type: "calendar", status: "closed", periodYear: 2026, periodMonth: 2,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: 0, chargedAmount: totalAmount,
        startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"),
        activatedAt: new Date(Date.UTC(2026, 1, 3 + (i % 10))), createdBy: owner.id,
      },
    })
    febSubs.push({ id: sub.id, clientId: cl.id, wardId: cl.wardId, groupIdx: gIdx, dirId: gd.dirId, price, totalLessons })
  }

  // Some Feb clients get 2nd direction (first 15)
  const febSecondGroups = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15, 3, 0, 1]
  for (let i = 0; i < 15; i++) {
    const cl = febClients[i]
    const gIdx = febSecondGroups[i]
    const gd = groups[gIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    const febDates = daysInMonth(2026, 2, gd.days)
    const totalLessons = febDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId: cl.id, wardId: cl.wardId, directionId: gd.dirId, groupId: groups[gIdx].id,
        type: "calendar", status: "closed", periodYear: 2026, periodMonth: 2,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: 0, chargedAmount: totalAmount,
        startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"),
        activatedAt: new Date(Date.UTC(2026, 1, 3 + (i % 10))), createdBy: owner.id,
      },
    })
    febSubs.push({ id: sub.id, clientId: cl.id, wardId: cl.wardId, groupIdx: gIdx, dirId: gd.dirId, price, totalLessons })
  }
  console.log("  Subscriptions (Feb): " + febSubs.length)

  // --- Feb enrollments (withdraw churned, add new) ---
  // Withdraw churned enrollments
  for (const cl of churnedJanClients) {
    await db.groupEnrollment.updateMany({
      where: { clientId: cl.id, isActive: true },
      data: { isActive: false, withdrawnAt: new Date("2026-02-15") },
    })
  }
  // New enrollments for feb subs
  for (const sub of febSubs) {
    // Check if enrollment already exists
    const existing = await db.groupEnrollment.findFirst({
      where: { clientId: sub.clientId, groupId: groups[sub.groupIdx].id, isActive: true },
    })
    if (!existing) {
      await db.groupEnrollment.create({
        data: {
          tenantId: T, groupId: groups[sub.groupIdx].id, clientId: sub.clientId, wardId: sub.wardId,
          enrolledAt: new Date("2026-02-01"), paymentStatus: "active", isActive: true,
        },
      })
    }
  }
  console.log("  GroupEnrollments updated for Feb")

  // --- Payments for Feb subs ---
  for (let pi = 0; pi < febSubs.length; pi++) {
    const sub = febSubs[pi]
    const pm = paymentMethod(pi + 50)
    const gd = groups[sub.groupIdx].def
    let accountId: string
    if (pm.accountKey === "branch") accountId = gd.branchId === brAkad.id ? accCashAkad.id : accCashPark.id
    else if (pm.accountKey === "acquiring") accountId = accAcq.id
    else accountId = accBank.id

    await db.payment.create({
      data: {
        tenantId: T, clientId: sub.clientId, subscriptionId: sub.id, accountId,
        amount: sub.totalLessons * sub.price, type: "incoming", method: pm.method,
        date: new Date(Date.UTC(2026, 1, 1 + (pi % 15))),
        isFirstPayment: false, createdBy: admin1.id,
      },
    })
  }
  console.log("  Payments (Feb): " + febSubs.length)

  // --- February lessons ---
  type LessonRecord = { id: string; groupIdx: number; date: Date; instId: string }
  const febLessons: LessonRecord[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const gd = g.def
    const dates = daysInMonth(2026, 2, gd.days)
    for (const dt of dates) {
      // Katerina sick Feb 10-14 → substitute with Olga for her groups
      let instId = gd.instId
      const dayNum = dt.getUTCDate()
      if (gd.instId === ctx.instKaterina.id && dayNum >= 10 && dayNum <= 14) {
        instId = ctx.instOlga.id
      }

      const lesson = await db.lesson.create({
        data: {
          tenantId: T, groupId: g.id, date: dt, startTime: gd.time, durationMinutes: gd.duration,
          instructorId: instId, status: "completed",
          topic: (dayNum % 7 === 0) ? `Тема занятия ${dayNum} февраля` : undefined,
        },
      })
      febLessons.push({ id: lesson.id, groupIdx: gi, date: dt, instId })
    }
  }
  console.log("  Lessons (Feb): " + febLessons.length)

  // --- Attendance Feb ---
  let attCount = 0
  const febEnrollMap: Record<number, typeof febSubs> = {}
  for (const sub of febSubs) {
    if (!febEnrollMap[sub.groupIdx]) febEnrollMap[sub.groupIdx] = []
    febEnrollMap[sub.groupIdx].push(sub)
  }

  for (const lesson of febLessons) {
    const enrolled = febEnrollMap[lesson.groupIdx] || []
    for (let si = 0; si < enrolled.length; si++) {
      const sub = enrolled[si]
      const atCode = attendanceTypeIndex(si, lesson.date.getUTCDate() + 31, 78)
      const atType = attTypeMap[atCode]
      if (!atType) continue

      const gd = groups[lesson.groupIdx].def
      const dir = ctx.dirs.find(d => d.id === gd.dirId)!
      const dirPrice = Number(dir.lessonPrice)
      const salaryKey = `${lesson.instId}_${gd.dirId}`
      const salaryRate = ctx.salaryRates[salaryKey] || 0

      await db.attendance.create({
        data: {
          tenantId: T, lessonId: lesson.id, subscriptionId: sub.id, clientId: sub.clientId,
          attendanceTypeId: atType.id,
          chargeAmount: atType.charges ? dirPrice : 0,
          instructorPayAmount: atType.pays ? salaryRate : 0,
          instructorPayEnabled: true,
          markedAt: new Date(lesson.date),
        },
      })
      attCount++
    }
  }
  console.log("  Attendance (Feb): " + attCount)

  // --- Salary payments for January ---
  const instructors = [
    ctx.instSergey, ctx.instOlga, ctx.instKaterina, ctx.instDmitriy,
    ctx.instMaria, ctx.instAlexey, ctx.instIrina, ctx.instPavel, ctx.instNatalya,
  ]
  for (const inst of instructors) {
    // Sum instructor pay from Jan attendance
    const janPay = await db.attendance.aggregate({
      where: { tenantId: T, instructorPayEnabled: true, lesson: { instructorId: inst.id, date: { gte: new Date("2026-01-01"), lt: new Date("2026-02-01") } } },
      _sum: { instructorPayAmount: true },
    })
    const amount = Number(janPay._sum.instructorPayAmount || 0)
    if (amount > 0) {
      await db.salaryPayment.create({
        data: {
          tenantId: T, employeeId: inst.id, accountId: accBank.id,
          amount, date: new Date("2026-02-05"),
          periodYear: 2026, periodMonth: 1, periodHalf: 2,
          createdBy: owner.id,
        },
      })
    }
  }
  console.log("  SalaryPayments for Jan: done")

  // --- Expenses February ---
  const febExpenses = [
    { catName: "Аренда", amount: 50000, branchId: brAkad.id, date: "2026-02-10" },
    { catName: "Аренда", amount: 40000, branchId: brPark.id, date: "2026-02-10" },
    { catName: "Коммунальные", amount: 8000, branchId: brAkad.id, date: "2026-02-15" },
    { catName: "Коммунальные", amount: 7000, branchId: brPark.id, date: "2026-02-15" },
    { catName: "Маркетинг", amount: 15000, branchId: brAkad.id, date: "2026-02-08", comment: "Инстаграм" },
    { catName: "Маркетинг", amount: 5000, branchId: brPark.id, date: "2026-02-08", comment: "Авито" },
    { catName: "Маркетинг", amount: 10000, branchId: brAkad.id, date: "2026-02-20", comment: "Весенняя кампания" },
    { catName: "Канцтовары", amount: 7000, branchId: brAkad.id, date: "2026-02-12" },
    { catName: "Канцтовары", amount: 4000, branchId: brPark.id, date: "2026-02-12" },
    { catName: "Интернет", amount: 3000, branchId: brAkad.id, date: "2026-02-05" },
    { catName: "Интернет", amount: 2000, branchId: brPark.id, date: "2026-02-05" },
    { catName: "Хозтовары", amount: 12000, branchId: brAkad.id, date: "2026-02-18" },
    { catName: "Хозтовары", amount: 7000, branchId: brPark.id, date: "2026-02-18" },
  ]
  for (const exp of febExpenses) {
    const expense = await db.expense.create({
      data: {
        tenantId: T, categoryId: cats[exp.catName], accountId: accBank.id,
        amount: exp.amount, date: new Date(exp.date),
        comment: (exp as any).comment || undefined, createdBy: owner.id,
      },
    })
    await db.expenseBranch.create({
      data: { tenantId: T, expenseId: expense.id, branchId: exp.branchId },
    })
  }
  console.log("  Expenses (Feb): " + febExpenses.length)

  // --- Planned expenses for March ---
  await db.plannedExpense.create({
    data: { tenantId: T, categoryId: cats["Аренда"], periodYear: 2026, periodMonth: 3, plannedAmount: 90000 },
  })
  await db.plannedExpense.create({
    data: { tenantId: T, categoryId: cats["Маркетинг"], periodYear: 2026, periodMonth: 3, plannedAmount: 30000 },
  })
  console.log("  PlannedExpenses for March: 2")

  // --- Period February (closed) ---
  await db.period.create({
    data: { tenantId: T, year: 2026, month: 2, status: "closed", closedAt: new Date("2026-03-01"), closedBy: owner.id },
  })
  console.log("  Period Feb: closed")

  return { febClients, febSubs, febAllClientIds, churnedJanClients }
}

// ============================================================
// STEP 4: MARCH
// ============================================================
async function step4_march(
  ctx: Awaited<ReturnType<typeof step1_setup>>,
  janData: Awaited<ReturnType<typeof step2_january>>,
  febData: Awaited<ReturnType<typeof step3_february>>
) {
  console.log("\n=== STEP 4: March 2026 ===")
  const { T, brAkad, brPark, owner, admin1, admin2, groups, attTypeMap, cats, accCashAkad, accCashPark, accBank, accAcq } = ctx

  // New leads for March (50)
  const marLeadNames = [
    { first: "Алёна", last: "Агеева" }, { first: "Борислав", last: "Беляков" }, { first: "Василиса", last: "Воронцова" },
    { first: "Геннадий", last: "Громов" }, { first: "Дина", last: "Данилова" }, { first: "Евгений", last: "Елизаров" },
    { first: "Жанна", last: "Жигалова" }, { first: "Захар", last: "Зиновьев" }, { first: "Инна", last: "Исаева" },
    { first: "Клим", last: "Кондратьев" }, { first: "Любовь", last: "Логинова" }, { first: "Матвей", last: "Муравьёв" },
    { first: "Нина", last: "Нестерова" }, { first: "Остап", last: "Орехов" }, { first: "Полина", last: "Прохорова" },
    { first: "Радмила", last: "Рудакова" }, { first: "Станислав", last: "Сорокин" }, { first: "Тамила", last: "Троицкая" },
    { first: "Ульяна", last: "Устинова" }, { first: "Филипп", last: "Филатов" }, { first: "Христофор", last: "Харламов" },
    { first: "Цветана", last: "Цыганкова" }, { first: "Чеслав", last: "Чудинов" }, { first: "Шамиль", last: "Шаповалов" },
    { first: "Эмма", last: "Эрнст" }, { first: "Юрий", last: "Юрченко" }, { first: "Ярослава", last: "Яшкина" },
    { first: "Антон", last: "Астахов" }, { first: "Белла", last: "Булатова" }, { first: "Виталий", last: "Власов" },
    { first: "Глеб", last: "Горелов" }, { first: "Дарья", last: "Дьякова" }, { first: "Елена", last: "Ерохина" },
    { first: "Жора", last: "Жилин" }, { first: "Зинаида", last: "Зуева" }, { first: "Илья", last: "Ильюшин" },
    { first: "Камилла", last: "Калмыкова" }, { first: "Лада", last: "Лукьянова" }, { first: "Марат", last: "Миронов" },
    { first: "Нелли", last: "Новосёлова" }, { first: "Олег", last: "Оськин" }, { first: "Прасковья", last: "Поликарпова" },
    { first: "Рустам", last: "Родионов" }, { first: "Снежана", last: "Самсонова" }, { first: "Тарас", last: "Третьяков" },
    { first: "Ульрих", last: "Уваров" }, { first: "Фаина", last: "Фомичёва" }, { first: "Харитон", last: "Хохлов" },
    { first: "Цезарь", last: "Целиков" }, { first: "Эльвира", last: "Эсаулова" },
  ]
  const marChildNames = [
    "Амелия", "Бенедикт", "Велена", "Гордей", "Дана", "Елизар", "Жасмин", "Зоран", "Иванна", "Клара",
    "Леонард", "Марьяна", "Нестор", "Олимпия", "Пересвет", "Рада", "Серафим", "Тея", "Устин", "Франческа",
    "Харита", "Цветана", "Шарлотта", "Элеонора", "Юстина", "Ядвига", "Авдей", "Борислава", "Всеволод", "Герда",
    "Добрыня", "Евдокия", "Златослава", "Ипполит", "Калерия", "Любомир", "Мирослава", "Нежана", "Олесь", "Пелагея",
  ]

  const marClients: { id: string; wardId: string; branchId: string; idx: number }[] = []

  for (let i = 0; i < 50; i++) {
    const ln = marLeadNames[i]
    const brId = i % 3 === 0 ? brPark.id : brAkad.id
    const phone = `+7 (9${String(70 + (i % 30)).padStart(2, "0")}) ${String(300 + i * 2).padStart(3, "0")}-${String(50 + i).padStart(2, "0")}-${String(60 + i).padStart(2, "0")}`

    let funnelStatus: "active_client" | "potential" | "non_target" | "trial_scheduled" | "new"
    let clientStatus: "active" | null = null
    if (i < 40) { funnelStatus = "active_client"; clientStatus = "active" }
    else if (i < 44) funnelStatus = "potential"
    else if (i < 46) funnelStatus = "trial_scheduled"
    else funnelStatus = "new"

    const client = await db.client.create({
      data: {
        tenantId: T, firstName: ln.first, lastName: ln.last, phone, funnelStatus, clientStatus,
        segment: "new_client", branchId: brId,
        comment: `Канал: ${channelForLead(i + 80)}`,
        createdAt: new Date(Date.UTC(2026, 2, 1 + (i % 25))),
        firstPaymentDate: i < 40 ? new Date(Date.UTC(2026, 2, 2 + (i % 15))) : undefined,
        saleDate: i < 40 ? new Date(Date.UTC(2026, 2, 2 + (i % 15))) : undefined,
      },
    })

    if (i < 40) {
      const ward = await db.ward.create({
        data: { tenantId: T, clientId: client.id, firstName: marChildNames[i], birthDate: new Date(Date.UTC(2017 + (i % 6), (i + 5) % 12, 1 + (i % 28))) },
      })
      marClients.push({ id: client.id, wardId: ward.id, branchId: brId, idx: i })
    }
  }
  console.log("  New leads (Mar): 50 (40 converted)")

  // Churn 3 more Feb clients
  const churnedFebClients = febData.febClients.slice(22, 25)
  for (const cl of churnedFebClients) {
    await db.client.update({
      where: { id: cl.id },
      data: { clientStatus: "churned", funnelStatus: "archived", withdrawalDate: new Date("2026-03-10") },
    })
  }

  // 2 formal withdrawals with reasons
  // Client X (jan client #20 already churned) — reason "Переехали"
  await db.client.update({
    where: { id: janData.clients[20].id },
    data: { comment: "Причина отчисления: Переехали в другой район" },
  })
  // Client Y (jan client #21 already churned) — reason "Финансовые трудности"
  await db.client.update({
    where: { id: janData.clients[21].id },
    data: { comment: "Причина отчисления: Финансовые трудности" },
  })
  console.log("  Churned: 3 Feb + 2 formal withdrawals")

  // 1 returning feb client
  const returningFeb = febData.febClients[20]
  await db.client.update({
    where: { id: returningFeb.id },
    data: { clientStatus: "active", funnelStatus: "active_client" },
  })
  console.log("  Returning: 1")

  // --- March subscriptions ---
  // Continuing from Feb: ~all active clients. Let's aim for 150 total.
  const marSubs: { id: string; clientId: string; wardId: string; groupIdx: number; dirId: string; price: number; totalLessons: number }[] = []

  // Helper to create march sub
  async function createMarSub(clientId: string, wardId: string, gIdx: number, status: "active" | "closed" = "active") {
    const gd = groups[gIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    // March: skip March 8 (holiday)
    const marDates = daysInMonth(2026, 3, gd.days).filter(d => d.getUTCDate() !== 8)
    const totalLessons = marDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId, wardId, directionId: gd.dirId, groupId: groups[gIdx].id,
        type: "calendar", status, periodYear: 2026, periodMonth: 3,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: status === "active" ? totalAmount : 0, chargedAmount: status === "active" ? 0 : totalAmount,
        startDate: new Date("2026-03-01"), endDate: new Date("2026-03-31"),
        activatedAt: new Date("2026-03-01"), createdBy: owner.id,
      },
    })
    marSubs.push({ id: sub.id, clientId, wardId, groupIdx: gIdx, dirId: gd.dirId, price, totalLessons })
    return sub
  }

  // Jan continuing clients (0-19, minus 5 churned = indices 0-17 active)
  // Actually from Jan: 0-19 stayed, 20-24 churned in Feb. So indices 0-19 are still active minus returning logic.
  // Let's just take first 18 jan clients as continuing
  for (let i = 0; i < 18; i++) {
    const cl = janData.clients[i]
    // Primary group
    const primaryGroupAssign = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4]
    await createMarSub(cl.id, cl.wardId, primaryGroupAssign[i])
  }

  // Some jan clients second direction
  const janSecondMar = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15]
  for (let i = 0; i < 12; i++) {
    const cl = janData.clients[i]
    await createMarSub(cl.id, cl.wardId, janSecondMar[i])
  }

  // Feb continuing clients (0-21, minus 3 churned 22-24)
  for (let i = 0; i < 22; i++) {
    const cl = febData.febClients[i]
    const febPrimaryGroups = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6, 1, 3, 5]
    await createMarSub(cl.id, cl.wardId, febPrimaryGroups[i])
  }

  // Some Feb clients second direction
  const febSecondMar = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15]
  for (let i = 0; i < 12; i++) {
    const cl = febData.febClients[i]
    await createMarSub(cl.id, cl.wardId, febSecondMar[i])
  }

  // New March clients
  const marPrimaryGroups = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6, 1, 3, 5, 11, 12, 17, 0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16]
  for (let i = 0; i < 40; i++) {
    const cl = marClients[i]
    await createMarSub(cl.id, cl.wardId, marPrimaryGroups[i])
  }

  // Some Mar clients second direction (first 20)
  const marSecondGroups = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15, 3, 0, 1, 16, 17, 6, 5, 9]
  for (let i = 0; i < 20; i++) {
    const cl = marClients[i]
    await createMarSub(cl.id, cl.wardId, marSecondGroups[i])
  }

  // Returning client
  await createMarSub(returningFeb.id, returningFeb.wardId, 3)

  console.log("  Subscriptions (Mar): " + marSubs.length)

  // --- Update enrollments for March ---
  // Withdraw churned feb clients
  for (const cl of churnedFebClients) {
    await db.groupEnrollment.updateMany({
      where: { clientId: cl.id, isActive: true },
      data: { isActive: false, withdrawnAt: new Date("2026-03-10") },
    })
  }
  // Create new enrollments
  for (const sub of marSubs) {
    const existing = await db.groupEnrollment.findFirst({
      where: { clientId: sub.clientId, groupId: groups[sub.groupIdx].id, isActive: true },
    })
    if (!existing) {
      await db.groupEnrollment.create({
        data: {
          tenantId: T, groupId: groups[sub.groupIdx].id, clientId: sub.clientId, wardId: sub.wardId,
          enrolledAt: new Date("2026-03-01"), paymentStatus: "active", isActive: true,
        },
      })
    }
  }
  console.log("  GroupEnrollments updated for Mar")

  // --- Payments for March ---
  for (let pi = 0; pi < marSubs.length; pi++) {
    const sub = marSubs[pi]
    const pm = paymentMethod(pi + 140)
    const gd = groups[sub.groupIdx].def
    let accountId: string
    if (pm.accountKey === "branch") accountId = gd.branchId === brAkad.id ? accCashAkad.id : accCashPark.id
    else if (pm.accountKey === "acquiring") accountId = accAcq.id
    else accountId = accBank.id

    await db.payment.create({
      data: {
        tenantId: T, clientId: sub.clientId, subscriptionId: sub.id, accountId,
        amount: sub.totalLessons * sub.price, type: "incoming", method: pm.method,
        date: new Date(Date.UTC(2026, 2, 1 + (pi % 20))),
        isFirstPayment: false, createdBy: admin1.id,
      },
    })
  }
  console.log("  Payments (Mar): " + marSubs.length)

  // --- Production calendar: March 8 ---
  await db.productionCalendar.create({
    data: { tenantId: T, date: new Date("2026-03-08"), isWorking: false, comment: "Международный женский день" },
  })
  console.log("  ProductionCalendar: March 8 holiday")

  // --- March lessons (skip March 8) ---
  type LessonRecord = { id: string; groupIdx: number; date: Date; instId: string }
  const marLessons: LessonRecord[] = []
  const today = new Date("2026-04-07")

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const gd = g.def
    const dates = daysInMonth(2026, 3, gd.days).filter(d => d.getUTCDate() !== 8)
    for (const dt of dates) {
      const isPast = dt < today
      const lesson = await db.lesson.create({
        data: {
          tenantId: T, groupId: g.id, date: dt, startTime: gd.time, durationMinutes: gd.duration,
          instructorId: gd.instId, status: isPast ? "completed" : "scheduled",
          topic: (dt.getUTCDate() % 6 === 0) ? `Тема занятия ${dt.getUTCDate()} марта` : undefined,
        },
      })
      if (isPast) {
        marLessons.push({ id: lesson.id, groupIdx: gi, date: dt, instId: gd.instId })
      }
    }
  }
  console.log("  Lessons (Mar): " + marLessons.length + " completed")

  // --- Attendance March (only completed lessons) ---
  let attCount = 0
  const marEnrollMap: Record<number, typeof marSubs> = {}
  for (const sub of marSubs) {
    if (!marEnrollMap[sub.groupIdx]) marEnrollMap[sub.groupIdx] = []
    marEnrollMap[sub.groupIdx].push(sub)
  }

  for (const lesson of marLessons) {
    const enrolled = marEnrollMap[lesson.groupIdx] || []
    for (let si = 0; si < enrolled.length; si++) {
      const sub = enrolled[si]
      const atCode = attendanceTypeIndex(si, lesson.date.getUTCDate() + 59, 78)
      const atType = attTypeMap[atCode]
      if (!atType) continue

      const gd = groups[lesson.groupIdx].def
      const dir = ctx.dirs.find(d => d.id === gd.dirId)!
      const dirPrice = Number(dir.lessonPrice)
      const salaryKey = `${lesson.instId}_${gd.dirId}`
      const salaryRate = ctx.salaryRates[salaryKey] || 0

      await db.attendance.create({
        data: {
          tenantId: T, lessonId: lesson.id, subscriptionId: sub.id, clientId: sub.clientId,
          attendanceTypeId: atType.id,
          chargeAmount: atType.charges ? dirPrice : 0,
          instructorPayAmount: atType.pays ? salaryRate : 0,
          instructorPayEnabled: true,
          markedAt: new Date(lesson.date),
        },
      })
      attCount++
    }
  }
  console.log("  Attendance (Mar): " + attCount)

  // --- Salary payments for February ---
  const instructors = [
    ctx.instSergey, ctx.instOlga, ctx.instKaterina, ctx.instDmitriy,
    ctx.instMaria, ctx.instAlexey, ctx.instIrina, ctx.instPavel, ctx.instNatalya,
  ]
  for (const inst of instructors) {
    const febPay = await db.attendance.aggregate({
      where: { tenantId: T, instructorPayEnabled: true, lesson: { instructorId: inst.id, date: { gte: new Date("2026-02-01"), lt: new Date("2026-03-01") } } },
      _sum: { instructorPayAmount: true },
    })
    const amount = Number(febPay._sum.instructorPayAmount || 0)
    if (amount > 0) {
      await db.salaryPayment.create({
        data: {
          tenantId: T, employeeId: inst.id, accountId: accBank.id,
          amount, date: new Date("2026-03-05"),
          periodYear: 2026, periodMonth: 2, periodHalf: 2,
          createdBy: owner.id,
        },
      })
    }
  }
  console.log("  SalaryPayments for Feb: done")

  // --- Expenses March ---
  const marExpenses = [
    { catName: "Аренда", amount: 50000, branchId: brAkad.id, date: "2026-03-10" },
    { catName: "Аренда", amount: 40000, branchId: brPark.id, date: "2026-03-10" },
    { catName: "Коммунальные", amount: 9000, branchId: brAkad.id, date: "2026-03-15" },
    { catName: "Коммунальные", amount: 7500, branchId: brPark.id, date: "2026-03-15" },
    { catName: "Маркетинг", amount: 20000, branchId: brAkad.id, date: "2026-03-05", comment: "Инстаграм — весна" },
    { catName: "Маркетинг", amount: 8000, branchId: brPark.id, date: "2026-03-05", comment: "Авито + VK" },
    { catName: "Маркетинг", amount: 10000, branchId: brAkad.id, date: "2026-03-18", comment: "Листовки + баннер" },
    { catName: "Канцтовары", amount: 8000, branchId: brAkad.id, date: "2026-03-12" },
    { catName: "Канцтовары", amount: 5000, branchId: brPark.id, date: "2026-03-12" },
    { catName: "Интернет", amount: 3000, branchId: brAkad.id, date: "2026-03-05" },
    { catName: "Интернет", amount: 2000, branchId: brPark.id, date: "2026-03-05" },
    { catName: "Хозтовары", amount: 15000, branchId: brAkad.id, date: "2026-03-20" },
    { catName: "Хозтовары", amount: 10000, branchId: brPark.id, date: "2026-03-20" },
    { catName: "Ремонт", amount: 13500, branchId: brAkad.id, date: "2026-03-25" },
  ]
  for (const exp of marExpenses) {
    const expense = await db.expense.create({
      data: {
        tenantId: T, categoryId: cats[exp.catName], accountId: accBank.id,
        amount: exp.amount, date: new Date(exp.date),
        comment: (exp as any).comment || undefined, createdBy: owner.id,
      },
    })
    await db.expenseBranch.create({
      data: { tenantId: T, expenseId: expense.id, branchId: exp.branchId },
    })
  }
  console.log("  Expenses (Mar): " + marExpenses.length)

  // --- Call campaign ---
  const churnedAll = [...janData.clients.slice(20, 25), ...churnedFebClients]
  const campaign = await db.callCampaign.create({
    data: {
      tenantId: T, name: "Возврат ушедших — март", status: "active",
      filterCriteria: { status: "churned" }, totalItems: 8, completedItems: 2,
      createdBy: owner.id,
    },
  })
  const callStatuses: ("completed" | "no_answer" | "callback" | "called")[] = ["completed", "completed", "no_answer", "no_answer", "callback", "callback", "called", "called"]
  const callComments = ["Вернётся в апреле", "Отказ — финансы", "Не берёт трубку", "Не берёт трубку", "Перезвонить через неделю", "Перезвонить в пятницу", "Не планирует возвращаться", "Переехали"]
  for (let i = 0; i < 8; i++) {
    await db.callCampaignItem.create({
      data: {
        tenantId: T, campaignId: campaign.id, clientId: churnedAll[i % churnedAll.length].id,
        status: callStatuses[i], comment: callComments[i],
        result: callStatuses[i] === "completed" ? (i === 0 ? "Возврат" : "Отказ") : undefined,
        calledBy: admin1.id,
        calledAt: new Date(Date.UTC(2026, 2, 15 + i)),
      },
    })
  }
  console.log("  CallCampaign: 1 with 8 items")

  // --- Unprolonged comments ---
  // 5 clients whose Feb subs weren't renewed → these are churned clients
  for (let i = 0; i < 5; i++) {
    const cl = churnedAll[i % churnedAll.length]
    // Find a jan sub for this client
    const oldSub = janData.janSubs.find(s => s.clientId === cl.id)
    if (oldSub) {
      await db.unprolongedComment.create({
        data: {
          tenantId: T, clientId: cl.id, subscriptionId: oldSub.id,
          periodYear: 2026, periodMonth: 2,
          comment: ["Не ответила на звонок", "Финансовые трудности", "Переехали", "Ребёнок заболел — временно", "Нет времени"][i],
          createdBy: admin1.id,
        },
      })
    }
  }
  console.log("  UnprolongedComments: 5")

  // --- Notifications ---
  const notifDefs = [
    { type: "unmarked_lesson" as const, title: "Неотмеченное занятие", message: "Робототехника Пн/Ср 10:00 — 31 марта", empId: admin1.id },
    { type: "unmarked_lesson" as const, title: "Неотмеченное занятие", message: "Английский Вт/Чт 17:00 — 31 марта", empId: admin1.id },
    { type: "overdue_payment" as const, title: "Просроченная оплата", message: "Агеева Алёна — задолженность", empId: admin1.id },
    { type: "overdue_payment" as const, title: "Просроченная оплата", message: "Беляков Борислав — задолженность", empId: admin2.id },
    { type: "trial_reminder" as const, title: "Пробное занятие завтра", message: "Прохорова Полина — Рисование, 28 марта", empId: admin1.id },
    { type: "period_close" as const, title: "Период закрыт", message: "Февраль 2026 закрыт", empId: owner.id },
  ]
  for (const n of notifDefs) {
    await db.notification.create({
      data: { tenantId: T, employeeId: n.empId, type: n.type, title: n.title, message: n.message },
    })
  }
  console.log("  Notifications: 6")

  // --- Audit log ---
  const auditDefs = [
    { action: "create", entityType: "Payment", date: "2026-03-01" },
    { action: "create", entityType: "Payment", date: "2026-03-02" },
    { action: "create", entityType: "Payment", date: "2026-03-05" },
    { action: "update", entityType: "Attendance", date: "2026-03-10" },
    { action: "create", entityType: "Expense", date: "2026-03-10" },
    { action: "create", entityType: "Expense", date: "2026-03-12" },
    { action: "create", entityType: "SalaryPayment", date: "2026-03-05" },
    { action: "create", entityType: "Subscription", date: "2026-03-01" },
    { action: "update", entityType: "Client", date: "2026-03-10" },
    { action: "delete", entityType: "Subscription", date: "2026-03-15" },
    { action: "create", entityType: "Payment", date: "2026-03-18" },
    { action: "update", entityType: "Expense", date: "2026-03-25" },
  ]
  // We need a valid entityId — use org.id as a placeholder (audit log is for display)
  for (const a of auditDefs) {
    await db.auditLog.create({
      data: {
        tenantId: T, employeeId: owner.id, action: a.action,
        entityType: a.entityType, entityId: T, // org id as placeholder
        changes: { note: `${a.action} ${a.entityType}` },
        createdAt: new Date(a.date),
      },
    })
  }
  console.log("  AuditLog: 12")

  // --- Period March (open) ---
  await db.period.create({
    data: { tenantId: T, year: 2026, month: 3, status: "open" },
  })
  console.log("  Period Mar: open")

  return { marClients, marSubs, churnedFebClients }
}

// ============================================================
// STEP 7: CLOSE MARCH + APRIL (1-8)
// ============================================================
async function step7_closeMarchAndApril(
  ctx: Awaited<ReturnType<typeof step1_setup>>,
  janData: Awaited<ReturnType<typeof step2_january>>,
  febData: Awaited<ReturnType<typeof step3_february>>,
  marData: Awaited<ReturnType<typeof step4_march>>
) {
  console.log("\n=== STEP 7: Close March + April 1-8 ===")
  const { T, brAkad, brPark, owner, admin1, admin2, groups, attTypeMap, cats, accCashAkad, accCashPark, accBank, accAcq } = ctx

  // ────────────────────────────────────────
  // 7A. CLOSE MARCH PERIOD
  // ────────────────────────────────────────

  // Close March period
  await db.period.update({
    where: { tenantId_year_month: { tenantId: T, year: 2026, month: 3 } },
    data: { status: "closed", closedAt: new Date("2026-04-01"), closedBy: owner.id },
  })
  console.log("  Period Mar: closed")

  // Close all March subscriptions
  const marSubsClosed = await db.subscription.updateMany({
    where: { tenantId: T, periodYear: 2026, periodMonth: 3, status: "active" },
    data: { status: "closed", balance: 0 },
  })
  console.log("  March subs closed: " + marSubsClosed.count)

  // Salary payments for March
  const instructors = [
    ctx.instSergey, ctx.instOlga, ctx.instKaterina, ctx.instDmitriy,
    ctx.instMaria, ctx.instAlexey, ctx.instIrina, ctx.instPavel, ctx.instNatalya,
  ]
  for (const inst of instructors) {
    const marPay = await db.attendance.aggregate({
      where: { tenantId: T, instructorPayEnabled: true, lesson: { instructorId: inst.id, date: { gte: new Date("2026-03-01"), lt: new Date("2026-04-01") } } },
      _sum: { instructorPayAmount: true },
    })
    const amount = Number(marPay._sum.instructorPayAmount || 0)
    if (amount > 0) {
      await db.salaryPayment.create({
        data: {
          tenantId: T, employeeId: inst.id, accountId: accBank.id,
          amount, date: new Date("2026-04-03"),
          periodYear: 2026, periodMonth: 3, periodHalf: 2,
          createdBy: owner.id,
        },
      })
    }
  }
  console.log("  SalaryPayments for Mar: done")

  // Mark March billing invoice as paid
  await db.billingInvoice.updateMany({
    where: { organizationId: T, number: "INV-2026-003" },
    data: { status: "paid", paidAt: new Date("2026-04-01"), paidAmount: 10000 },
  })
  console.log("  March billing invoice: paid")

  // ────────────────────────────────────────
  // 7B. APRIL LEADS (8 new)
  // ────────────────────────────────────────
  const aprLeadNames = [
    { first: "Виктория", last: "Романова" }, { first: "Артём", last: "Кудрявцев" },
    { first: "Анастасия", last: "Белякова" }, { first: "Денис", last: "Горбунов" },
    { first: "Ксения", last: "Макарова" }, { first: "Олег", last: "Лазарев" },
    { first: "Алина", last: "Титова" }, { first: "Николай", last: "Фролов" },
  ]
  const aprChildNames = ["Арсений", "Василина", "Демьян", "Злата", "Кузьма", "Лукерья", "Мирослав", "Ника"]
  const aprLeadChannels = ["Инстаграм", "Сарафанное радио", "Авито", "Сайт", "Инстаграм", "Листовки", "Сарафанное радио", "Авито"]

  // funnelStatuses: 0-4 → trial_scheduled (3 attended, 1 no_show, 1 still scheduled for Apr 9)
  // 5-6 → converted (active_client)
  // 7 → new
  const aprLeadStatuses: Array<{ funnel: "trial_scheduled" | "trial_attended" | "active_client" | "new"; client: "active" | null }> = [
    { funnel: "trial_attended", client: null },   // 0: attended trial
    { funnel: "trial_attended", client: null },   // 1: attended trial
    { funnel: "trial_attended", client: null },   // 2: attended trial
    { funnel: "trial_scheduled", client: null },  // 3: no_show
    { funnel: "trial_scheduled", client: null },  // 4: still scheduled for Apr 9
    { funnel: "active_client", client: "active" },// 5: converted
    { funnel: "active_client", client: "active" },// 6: converted
    { funnel: "new", client: null },              // 7: new lead
  ]

  const aprClients: { id: string; wardId: string; branchId: string; idx: number }[] = []
  const aprAllClientIds: string[] = []

  for (let i = 0; i < 8; i++) {
    const ln = aprLeadNames[i]
    const brId = i % 3 === 0 ? brPark.id : brAkad.id
    const phone = `+7 (9${String(80 + i).padStart(2, "0")}) ${String(500 + i * 3).padStart(3, "0")}-${String(70 + i).padStart(2, "0")}-${String(80 + i).padStart(2, "0")}`
    const st = aprLeadStatuses[i]

    const client = await db.client.create({
      data: {
        tenantId: T, firstName: ln.first, lastName: ln.last, phone,
        funnelStatus: st.funnel, clientStatus: st.client,
        segment: "new_client", branchId: brId,
        comment: `Канал: ${aprLeadChannels[i]}`,
        createdAt: new Date(Date.UTC(2026, 3, 1 + i)),
        firstPaymentDate: st.client === "active" ? new Date(Date.UTC(2026, 3, 5 + (i % 3))) : undefined,
        saleDate: st.client === "active" ? new Date(Date.UTC(2026, 3, 5 + (i % 3))) : undefined,
      },
    })
    aprAllClientIds.push(client.id)

    if (st.client === "active") {
      const ward = await db.ward.create({
        data: { tenantId: T, clientId: client.id, firstName: aprChildNames[i], birthDate: new Date(Date.UTC(2020 + (i % 3), i % 12, 10 + i)) },
      })
      aprClients.push({ id: client.id, wardId: ward.id, branchId: brId, idx: i })
    }
  }
  console.log("  April leads: 8 (2 converted)")

  // Trial lessons for April leads (indices 0-4)
  const trialGroupMapping = [0, 2, 4, 6, 1]
  const trialStatuses: Array<"attended" | "no_show" | "scheduled"> = ["attended", "attended", "attended", "no_show", "scheduled"]
  const trialDates = [3, 4, 5, 6, 9] // April dates

  for (let i = 0; i < 5; i++) {
    await db.trialLesson.create({
      data: {
        tenantId: T, clientId: aprAllClientIds[i], groupId: groups[trialGroupMapping[i]].id,
        status: trialStatuses[i],
        scheduledDate: new Date(Date.UTC(2026, 3, trialDates[i])),
        attendedAt: trialStatuses[i] === "attended" ? new Date(Date.UTC(2026, 3, trialDates[i])) : undefined,
      },
    })
  }
  console.log("  April trials: 5 (3 attended, 1 no_show, 1 scheduled)")

  // ────────────────────────────────────────
  // 7C. APRIL SUBSCRIPTIONS
  // ────────────────────────────────────────

  type SubRecord = { id: string; clientId: string; wardId: string; groupIdx: number; dirId: string; price: number; totalLessons: number }
  const aprSubs: SubRecord[] = []

  async function createAprSub(clientId: string, wardId: string, gIdx: number) {
    const gd = groups[gIdx].def
    const dir = ctx.dirs.find(d => d.id === gd.dirId)!
    const price = Number(dir.lessonPrice)
    const aprDates = daysInMonth(2026, 4, gd.days)
    const totalLessons = aprDates.length
    const totalAmount = totalLessons * price

    const sub = await db.subscription.create({
      data: {
        tenantId: T, clientId, wardId, directionId: gd.dirId, groupId: groups[gIdx].id,
        type: "calendar", status: "active", periodYear: 2026, periodMonth: 4,
        lessonPrice: price, totalLessons, totalAmount, discountAmount: 0, finalAmount: totalAmount,
        balance: totalAmount, chargedAmount: 0,
        startDate: new Date("2026-04-01"), endDate: new Date("2026-04-30"),
        activatedAt: new Date("2026-04-01"), createdBy: owner.id,
      },
    })
    aprSubs.push({ id: sub.id, clientId, wardId, groupIdx: gIdx, dirId: gd.dirId, price, totalLessons })
    return sub
  }

  // Jan continuing clients (first 18)
  const janPrimaryGroupAssign = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4]
  for (let i = 0; i < 18; i++) {
    const cl = janData.clients[i]
    await createAprSub(cl.id, cl.wardId, janPrimaryGroupAssign[i])
  }
  // Jan second direction (first 12)
  const janSecondApr = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15]
  for (let i = 0; i < 12; i++) {
    const cl = janData.clients[i]
    await createAprSub(cl.id, cl.wardId, janSecondApr[i])
  }

  // Feb continuing clients (first 22, minus 3 churned in Mar)
  const febActiveCount = 19 // 22 - 3 churned
  const febPrimaryGroups = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6]
  for (let i = 0; i < febActiveCount; i++) {
    const cl = febData.febClients[i]
    await createAprSub(cl.id, cl.wardId, febPrimaryGroups[i])
  }
  // Feb second direction (first 10)
  const febSecondApr = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13]
  for (let i = 0; i < 10; i++) {
    const cl = febData.febClients[i]
    await createAprSub(cl.id, cl.wardId, febSecondApr[i])
  }

  // Mar continuing clients (first 37, 3 didn't renew)
  const marPrimaryGroups = [0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13, 14, 15, 16, 0, 2, 4, 6, 1, 3, 5, 11, 12, 17, 0, 2, 4, 6, 7, 1, 3, 5, 8, 11, 12, 13]
  for (let i = 0; i < 37; i++) {
    const cl = marData.marClients[i]
    await createAprSub(cl.id, cl.wardId, marPrimaryGroups[i])
  }
  // Mar second direction (first 17)
  const marSecondApr = [2, 5, 6, 11, 8, 4, 7, 9, 12, 13, 14, 15, 3, 0, 1, 16, 17]
  for (let i = 0; i < 17; i++) {
    const cl = marData.marClients[i]
    await createAprSub(cl.id, cl.wardId, marSecondApr[i])
  }

  // 2 new April clients (converted leads 5,6)
  const aprNewClientGroups = [0, 4]
  for (let i = 0; i < aprClients.length; i++) {
    const cl = aprClients[i]
    await createAprSub(cl.id, cl.wardId, aprNewClientGroups[i])
  }

  console.log("  Subscriptions (Apr): " + aprSubs.length)

  // 3 clients didn't renew → UnprolongedComments
  const didNotRenew = marData.marClients.slice(37, 40)
  for (let i = 0; i < didNotRenew.length; i++) {
    const cl = didNotRenew[i]
    const oldSub = marData.marSubs.find(s => s.clientId === cl.id)
    if (oldSub) {
      await db.unprolongedComment.create({
        data: {
          tenantId: T, clientId: cl.id, subscriptionId: oldSub.id,
          periodYear: 2026, periodMonth: 3,
          comment: ["Временно приостановили", "Уехали на дачу", "Финансовые трудности"][i],
          createdBy: admin1.id,
        },
      })
    }
    await db.client.update({
      where: { id: cl.id },
      data: { clientStatus: "churned", funnelStatus: "archived", withdrawalDate: new Date("2026-04-01") },
    })
  }
  console.log("  UnprolongedComments (Apr): 3")

  // Enrollments for April subs
  for (const sub of aprSubs) {
    const existing = await db.groupEnrollment.findFirst({
      where: { clientId: sub.clientId, groupId: groups[sub.groupIdx].id, isActive: true },
    })
    if (!existing) {
      await db.groupEnrollment.create({
        data: {
          tenantId: T, groupId: groups[sub.groupIdx].id, clientId: sub.clientId, wardId: sub.wardId,
          enrolledAt: new Date("2026-04-01"), paymentStatus: "active", isActive: true,
        },
      })
    }
  }
  console.log("  GroupEnrollments updated for Apr")

  // ────────────────────────────────────────
  // 7D. APRIL PAYMENTS
  // ────────────────────────────────────────
  for (let pi = 0; pi < aprSubs.length; pi++) {
    const sub = aprSubs[pi]
    const pm = paymentMethod(pi + 290)
    const gd = groups[sub.groupIdx].def
    let accountId: string
    if (pm.accountKey === "branch") accountId = gd.branchId === brAkad.id ? accCashAkad.id : accCashPark.id
    else if (pm.accountKey === "acquiring") accountId = accAcq.id
    else accountId = accBank.id

    await db.payment.create({
      data: {
        tenantId: T, clientId: sub.clientId, subscriptionId: sub.id, accountId,
        amount: sub.totalLessons * sub.price, type: "incoming", method: pm.method,
        date: new Date(Date.UTC(2026, 3, 1 + (pi % 5))),
        isFirstPayment: false, createdBy: admin1.id,
      },
    })
  }
  console.log("  Payments (Apr): " + aprSubs.length)

  // ────────────────────────────────────────
  // 7E. APRIL LESSONS (Apr 1-8)
  // ────────────────────────────────────────
  type LessonRecord = { id: string; groupIdx: number; date: Date; instId: string }
  const aprLessons: LessonRecord[] = []
  const aprScheduledLessons: string[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const gd = g.def
    // Generate lessons for April 1-8 only
    const allAprDates = daysInMonth(2026, 4, gd.days).filter(d => d.getUTCDate() <= 8)
    for (const dt of allAprDates) {
      const dayNum = dt.getUTCDate()
      // April 5 is Sunday (dow=7) — skip if group doesn't meet on Sunday
      // Actually daysInMonth already filters by group days, so Sunday groups will get Sunday dates
      // April 1 Wed, 2 Thu, 3 Fri, 4 Sat, 5 Sun, 6 Mon, 7 Tue, 8 Wed
      // Apr 1-4: completed with attendance; Apr 5-8: depends on date vs "today"
      // We treat Apr 5 (Sun) and beyond as: Apr 6-8 = scheduled (future), Apr 5 = depends
      const isCompleted = dayNum <= 4

      const lesson = await db.lesson.create({
        data: {
          tenantId: T, groupId: g.id, date: dt, startTime: gd.time, durationMinutes: gd.duration,
          instructorId: gd.instId, status: isCompleted ? "completed" : "scheduled",
          topic: (dayNum === 1 || dayNum === 3) ? `Тема занятия ${dayNum} апреля` : undefined,
        },
      })

      if (isCompleted) {
        aprLessons.push({ id: lesson.id, groupIdx: gi, date: dt, instId: gd.instId })
      } else {
        aprScheduledLessons.push(lesson.id)
      }
    }
  }
  console.log("  Lessons (Apr 1-8): " + aprLessons.length + " completed, " + aprScheduledLessons.length + " scheduled")

  // ────────────────────────────────────────
  // 7F. APRIL ATTENDANCE (completed lessons only)
  // ────────────────────────────────────────
  let attCount = 0
  const aprEnrollMap: Record<number, SubRecord[]> = {}
  for (const sub of aprSubs) {
    if (!aprEnrollMap[sub.groupIdx]) aprEnrollMap[sub.groupIdx] = []
    aprEnrollMap[sub.groupIdx].push(sub)
  }

  for (const lesson of aprLessons) {
    const enrolled = aprEnrollMap[lesson.groupIdx] || []
    for (let si = 0; si < enrolled.length; si++) {
      const sub = enrolled[si]
      const atCode = attendanceTypeIndex(si, lesson.date.getUTCDate() + 90, 75)
      const atType = attTypeMap[atCode]
      if (!atType) continue

      const gd = groups[lesson.groupIdx].def
      const dir = ctx.dirs.find(d => d.id === gd.dirId)!
      const dirPrice = Number(dir.lessonPrice)
      const salaryKey = `${lesson.instId}_${gd.dirId}`
      const salaryRate = ctx.salaryRates[salaryKey] || 0

      await db.attendance.create({
        data: {
          tenantId: T, lessonId: lesson.id, subscriptionId: sub.id, clientId: sub.clientId,
          attendanceTypeId: atType.id,
          chargeAmount: atType.charges ? dirPrice : 0,
          instructorPayAmount: atType.pays ? salaryRate : 0,
          instructorPayEnabled: true,
          markedAt: new Date(lesson.date),
        },
      })
      attCount++
    }
  }
  console.log("  Attendance (Apr 1-4): " + attCount)

  // ────────────────────────────────────────
  // 7G. APRIL EXPENSES (first week)
  // ────────────────────────────────────────
  const aprExpenses = [
    { catName: "Аренда", amount: 50000, branchId: brAkad.id, date: "2026-04-01" },
    { catName: "Аренда", amount: 40000, branchId: brPark.id, date: "2026-04-01" },
    { catName: "Маркетинг", amount: 8000, branchId: brAkad.id, date: "2026-04-03", comment: "Инстаграм — апрель" },
  ]
  for (const exp of aprExpenses) {
    const expense = await db.expense.create({
      data: {
        tenantId: T, categoryId: cats[exp.catName], accountId: accBank.id,
        amount: exp.amount, date: new Date(exp.date),
        comment: (exp as any).comment || undefined, createdBy: owner.id,
      },
    })
    await db.expenseBranch.create({
      data: { tenantId: T, expenseId: expense.id, branchId: exp.branchId },
    })
  }
  console.log("  Expenses (Apr): " + aprExpenses.length)

  // ────────────────────────────────────────
  // 7H. APRIL TASKS
  // ────────────────────────────────────────
  const aprTaskDefs = [
    { title: "Неотмеченное занятие: Танцы 4 апреля", type: "auto" as const, trigger: "unmarked_lesson" as const, due: "2026-04-08", status: "pending" as const },
    { title: "Просроченная оплата: Горбунов Денис", type: "auto" as const, trigger: "payment_due" as const, due: "2026-04-10", status: "pending" as const },
    { title: "Пробное занятие: Макарова Ксения (9 апреля)", type: "auto" as const, trigger: "trial_reminder" as const, due: "2026-04-09", status: "pending" as const },
    { title: "Позвонить непродлившим за март", type: "manual" as const, trigger: undefined, due: "2026-04-12", status: "pending" as const },
    { title: "Подготовить отчёт за март", type: "manual" as const, trigger: undefined, due: "2026-04-15", status: "pending" as const },
  ]
  for (const td of aprTaskDefs) {
    await db.task.create({
      data: {
        tenantId: T, title: td.title, type: td.type, autoTrigger: td.trigger,
        status: td.status, dueDate: new Date(td.due),
        assignedTo: admin1.id,
      },
    })
  }
  console.log("  Tasks (Apr): " + aprTaskDefs.length)

  // ────────────────────────────────────────
  // 7I. NOTIFICATIONS (fresh, unread)
  // ────────────────────────────────────────
  const aprNotifs = [
    { type: "unmarked_lesson" as const, title: "Неотмеченное занятие", message: "Танцы Вт/Чт/Сб 15:00 — 4 апреля не отмечено", empId: owner.id },
    { type: "overdue_payment" as const, title: "Просроченная оплата", message: "Горбунов Денис — не оплатил пробное", empId: owner.id },
    { type: "trial_reminder" as const, title: "Пробное занятие завтра", message: "Макарова Ксения — Английский, 9 апреля", empId: owner.id },
  ]
  for (const n of aprNotifs) {
    await db.notification.create({
      data: {
        tenantId: T, employeeId: n.empId, type: n.type, title: n.title, message: n.message,
        isRead: false, createdAt: new Date("2026-04-08T09:00:00Z"),
      },
    })
  }
  console.log("  Notifications (Apr, unread): 3")

  // ────────────────────────────────────────
  // 7J. BILLING INVOICE FOR APRIL
  // ────────────────────────────────────────
  const billingSub = await db.billingSubscription.findFirst({ where: { organizationId: T } })
  if (billingSub) {
    await db.billingInvoice.create({
      data: {
        subscriptionId: billingSub.id, organizationId: T, number: "INV-2026-004",
        amount: 10000, status: "pending", periodStart: new Date("2026-04-01"), periodEnd: new Date("2026-04-30"),
        dueDate: new Date("2026-04-10"),
      },
    })
    // Update subscription next payment date
    await db.billingSubscription.update({
      where: { id: billingSub.id },
      data: { nextPaymentDate: new Date("2026-05-01") },
    })
  }
  console.log("  BillingInvoice (Apr): pending")

  // ────────────────────────────────────────
  // 7K. PERIOD APRIL (open)
  // ────────────────────────────────────────
  await db.period.create({
    data: { tenantId: T, year: 2026, month: 4, status: "open" },
  })
  console.log("  Period Apr: open")

  // ────────────────────────────────────────
  // 7L. REALISM TOUCHES
  // ────────────────────────────────────────
  // 2 clients with promised payment dates
  if (marData.marClients.length > 5) {
    await db.client.update({
      where: { id: marData.marClients[3].id },
      data: { promisedPaymentDate: new Date("2026-04-10") },
    })
    await db.client.update({
      where: { id: marData.marClients[7].id },
      data: { promisedPaymentDate: new Date("2026-04-12") },
    })
  }
  // 1 client with next contact date
  if (marData.marClients.length > 10) {
    await db.client.update({
      where: { id: marData.marClients[10].id },
      data: { nextContactDate: new Date("2026-04-09") },
    })
  }
  console.log("  Realism: promisedPaymentDate x2, nextContactDate x1")

  // ────────────────────────────────────────
  // 7M. SUMMARY COUNTS
  // ────────────────────────────────────────
  const aprActiveSubs = await db.subscription.count({ where: { tenantId: T, periodYear: 2026, periodMonth: 4, status: "active" } })
  const aprLessonCount = await db.lesson.count({ where: { tenantId: T, date: { gte: new Date("2026-04-01"), lte: new Date("2026-04-08") } } })
  const unreadNotifs = await db.notification.count({ where: { tenantId: T, isRead: false } })
  const openTasks = await db.task.count({ where: { tenantId: T, status: "pending" } })

  console.log("  ── April Summary ──")
  console.log(`  Active April subs: ${aprActiveSubs}`)
  console.log(`  April 1-8 lessons: ${aprLessonCount}`)
  console.log(`  Unread notifications: ${unreadNotifs}`)
  console.log(`  Open tasks: ${openTasks}`)
}

// ============================================================
// STEP 5: CLIENT PORTAL
// ============================================================
async function step5_portal(
  ctx: Awaited<ReturnType<typeof step1_setup>>,
  janData: Awaited<ReturnType<typeof step2_january>>,
  febData: Awaited<ReturnType<typeof step3_february>>
) {
  console.log("\n=== STEP 5: Client Portal ===")
  const { T } = ctx
  const portalClients = [...janData.clients.slice(0, 5), ...febData.febClients.slice(0, 5)]

  for (let i = 0; i < portalClients.length; i++) {
    const cl = portalClients[i]
    const tokenHex = `portal-token-${String(i + 1).padStart(4, "0")}-${cl.id.substring(0, 8)}`
    await db.clientPortalToken.create({
      data: {
        tenantId: T, clientId: cl.id, token: tokenHex,
        isActive: true, pdnConsent: i < 8,
        pdnConsentDate: i < 8 ? new Date("2026-01-15") : undefined,
      },
    })
  }
  console.log("  ClientPortalTokens: 10 (8 with PDN consent)")
}

// ============================================================
// STEP 6: SUMMARY
// ============================================================
async function step6_summary(ctx: Awaited<ReturnType<typeof step1_setup>>) {
  console.log("\n=== STEP 6: Summary ===")
  const { T } = ctx

  const totalClients = await db.client.count({ where: { tenantId: T } })
  const activeClients = await db.client.count({ where: { tenantId: T, funnelStatus: "active_client" } })
  const totalSubs = await db.subscription.count({ where: { tenantId: T } })
  const activeSubs = await db.subscription.count({ where: { tenantId: T, status: "active" } })
  const closedSubs = await db.subscription.count({ where: { tenantId: T, status: "closed" } })
  const totalLessons = await db.lesson.count({ where: { tenantId: T } })
  const totalAttendance = await db.attendance.count({ where: { tenantId: T } })
  const totalPayments = await db.payment.count({ where: { tenantId: T } })
  const totalExpenses = await db.expense.count({ where: { tenantId: T } })

  const paymentSum = await db.payment.aggregate({ where: { tenantId: T }, _sum: { amount: true } })
  const expenseSum = await db.expense.aggregate({ where: { tenantId: T }, _sum: { amount: true } })

  console.log("  ─────────────────────────────────────")
  console.log(`  Всего клиентов (лиды+клиенты): ${totalClients}`)
  console.log(`  Активных клиентов: ${activeClients}`)
  console.log(`  Абонементов всего: ${totalSubs} (active: ${activeSubs}, closed: ${closedSubs})`)
  console.log(`  Занятий: ${totalLessons}`)
  console.log(`  Записей посещений: ${totalAttendance}`)
  console.log(`  Оплат: ${totalPayments}`)
  console.log(`  Расходов: ${totalExpenses}`)
  console.log(`  Общий доход: ${Number(paymentSum._sum.amount || 0).toLocaleString("ru-RU")} ₽`)
  console.log(`  Общие расходы: ${Number(expenseSum._sum.amount || 0).toLocaleString("ru-RU")} ₽`)
  console.log("  ─────────────────────────────────────")
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("╔════════════════════════════════════════╗")
  console.log("║  SEED: Умные дети — 4 мес (янв–апр), 2 филиала ║")
  console.log("╚════════════════════════════════════════╝")

  const { org } = await step0_backoffice()
  const setupCtx = await step1_setup(org)
  const janData = await step2_january(setupCtx)
  const febData = await step3_february(setupCtx, janData)
  const marData = await step4_march(setupCtx, janData, febData)
  await step5_portal(setupCtx, janData, febData)
  await step7_closeMarchAndApril(setupCtx, janData, febData, marData)
  await step6_summary(setupCtx)

  console.log("\n✅ Seed complete!")
  console.log("---")
  console.log("Демо-аккаунты (пароль: demo123):")
  console.log("  owner      — Татьяна Соколова (Владелец)")
  console.log("  manager    — Игорь Белов (Управляющий)")
  console.log("  admin      — Светлана Козлова (Админ, Академический)")
  console.log("  admin2     — Елена Морозова (Админ, Парковый)")
  console.log("  instructor — Ольга Петрова (Инструктор)")
  console.log("  inst2-inst9 — Инструкторы")
  console.log("  viewer     — Пётр Иванов (Только чтение)")
  console.log("")
  console.log("Бэк-офис (пароль: admin123):")
  console.log("  admin@umnayacrm.ru — Суперадмин")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
